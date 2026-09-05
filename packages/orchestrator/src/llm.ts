import Anthropic from "@anthropic-ai/sdk";
import { getServerEnv } from "@pulse/shared";

// Every LLM call in this package goes through here. Handles client caching,
// retry-with-backoff on the primary (DRAFT_MODEL) model, and a fallback to
// FALLBACK_MODEL if the primary keeps failing (per BUILD_CONTRACTS.md
// resilience rule: every external call wrapped in retry-with-backoff).

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: getServerEnv().ANTHROPIC_API_KEY });
  }
  return client;
}

export interface CallLLMOptions {
  system?: string;
  messages: Anthropic.MessageParam[];
  maxTokens?: number;
  temperature?: number;
  /**
   * Let the model search the web (Claude's server-side web_search tool). Pass a
   * number to cap searches per call. Web content is UNTRUSTED — it's data to
   * summarise, never instructions to follow.
   */
  webSearch?: boolean | number;
}

const PRIMARY_RETRIES = 2;
const BASE_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function attempt(model: string, opts: CallLLMOptions): Promise<string> {
  const req: Record<string, unknown> = {
    model,
    max_tokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature,
    system: opts.system,
    messages: opts.messages,
  };
  if (opts.webSearch) {
    const maxUses = typeof opts.webSearch === "number" ? opts.webSearch : 4;
    // Cast: the web_search server tool isn't in this SDK version's types, but the
    // API executes it server-side and returns the final text with citations.
    req.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: maxUses }];
  }
  const res = await getClient().messages.create(req as unknown as Anthropic.MessageCreateParamsNonStreaming);

  // Join every text block — with web search the answer can span more than one.
  const text = res.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
  if (!text) {
    throw new Error("LLM response contained no text content");
  }
  return text;
}

/**
 * Call the LLM. Retries the primary model (env DRAFT_MODEL) with exponential
 * backoff, then falls back to FALLBACK_MODEL for one final attempt if the
 * primary is still failing.
 */
export async function callLLM(opts: CallLLMOptions): Promise<string> {
  const env = getServerEnv();
  const plan: Array<{ model: string; retries: number }> = [
    { model: env.DRAFT_MODEL, retries: PRIMARY_RETRIES },
    { model: env.FALLBACK_MODEL, retries: 1 },
  ];

  let lastErr: unknown;
  for (const { model, retries } of plan) {
    for (let i = 0; i < retries; i++) {
      try {
        return await attempt(model, opts);
      } catch (err) {
        lastErr = err;
        const isVeryLastAttempt =
          model === plan[plan.length - 1]!.model && i === retries - 1;
        if (isVeryLastAttempt) break;
        await sleep(BASE_DELAY_MS * 2 ** i);
      }
    }
  }

  throw new Error(
    `callLLM failed on all models (${plan.map((p) => p.model).join(", ")}): ${String(lastErr)}`,
  );
}
