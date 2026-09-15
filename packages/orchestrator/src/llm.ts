import Anthropic from "@anthropic-ai/sdk";
import { getServerEnv, type ServerEnv } from "@pulse/shared";

// Every LLM call in this package goes through here. Handles client caching,
// retry-with-backoff on the primary model, optional fallback, and (when
// KIP_SMART_ROUTING is on) tier-based model selection.

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: getServerEnv().ANTHROPIC_API_KEY });
  }
  return client;
}

/** Task difficulty for model routing. Ignored for selection when routing is off. */
export type LlmTier = "fast" | "standard" | "smart";

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
  /** Model routing tier. Default `"standard"`. Used for logging even when routing is off. */
  tier?: LlmTier;
  /** Short label for structured logs (e.g. "classify", "think", "speak"). */
  task?: string;
}

export interface ModelPlanStep {
  model: string;
  retries: number;
}

/** Env slice needed to resolve a model plan (full ServerEnv or a test stub). */
export type ModelPlanEnv = Pick<
  ServerEnv,
  "DRAFT_MODEL" | "FALLBACK_MODEL" | "SMART_MODEL" | "KIP_SMART_ROUTING"
>;

const PRIMARY_RETRIES = 2;
const BASE_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve which models to try (and how many attempts) for a tier.
 * When `KIP_SMART_ROUTING` is false/unset, always returns the standard plan
 * (DRAFT retries → FALLBACK once), regardless of `tier`.
 */
export function resolveModelPlan(tier: LlmTier | undefined, env: ModelPlanEnv): ModelPlanStep[] {
  const effective: LlmTier = env.KIP_SMART_ROUTING ? (tier ?? "standard") : "standard";

  if (effective === "fast") {
    // Cost-predictable: Haiku only, no Sonnet fallback.
    return [{ model: env.DRAFT_MODEL, retries: PRIMARY_RETRIES }];
  }

  if (effective === "smart") {
    const smart = env.SMART_MODEL || env.FALLBACK_MODEL;
    return [
      { model: smart, retries: PRIMARY_RETRIES },
      { model: env.DRAFT_MODEL, retries: 1 },
    ];
  }

  // standard (and routing-off)
  return [
    { model: env.DRAFT_MODEL, retries: PRIMARY_RETRIES },
    { model: env.FALLBACK_MODEL, retries: 1 },
  ];
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

  // With web search the model may emit a pre-search "I'll look into…" text block
  // before the tool runs. Take only the text AFTER the last tool block — the real
  // answer — falling back to all text if there were no tools.
  const lastToolIdx = res.content.reduce((acc, b, i) => (b.type !== "text" ? i : acc), -1);
  const finalBlocks = res.content.filter((b, i): b is Anthropic.TextBlock => b.type === "text" && i > lastToolIdx);
  const blocks = finalBlocks.length
    ? finalBlocks
    : res.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
  const text = blocks.map((b) => b.text).join("").trim();
  if (!text) {
    throw new Error("LLM response contained no text content");
  }
  return text;
}

/**
 * Strip markdown that renders as literal characters over SMS/iMessage: bold/italic
 * asterisks, headers, inline-code backticks. Keeps plain prose intact.
 */
export function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function logLlmCall(fields: {
  task: string | undefined;
  tier: LlmTier;
  model: string;
  ok: boolean;
  ms: number;
}): void {
  console.info({
    event: "llm_call",
    task: fields.task ?? null,
    tier: fields.tier,
    model: fields.model,
    ok: fields.ok,
    ms: fields.ms,
  });
}

/**
 * Call the LLM. Model order depends on tier when KIP_SMART_ROUTING is enabled;
 * otherwise DRAFT_MODEL retries then FALLBACK_MODEL once (legacy behaviour).
 */
export async function callLLM(opts: CallLLMOptions): Promise<string> {
  const env = getServerEnv();
  const tier: LlmTier = opts.tier ?? "standard";
  const plan = resolveModelPlan(tier, env);
  const started = Date.now();

  let lastErr: unknown;
  let lastModel = plan[0]?.model ?? env.DRAFT_MODEL;

  for (const { model, retries } of plan) {
    lastModel = model;
    for (let i = 0; i < retries; i++) {
      try {
        const text = await attempt(model, opts);
        logLlmCall({
          task: opts.task,
          tier,
          model,
          ok: true,
          ms: Date.now() - started,
        });
        return text;
      } catch (err) {
        lastErr = err;
        const isVeryLastAttempt =
          model === plan[plan.length - 1]!.model && i === retries - 1;
        if (isVeryLastAttempt) break;
        await sleep(BASE_DELAY_MS * 2 ** i);
      }
    }
  }

  logLlmCall({
    task: opts.task,
    tier,
    model: lastModel,
    ok: false,
    ms: Date.now() - started,
  });

  throw new Error(
    `callLLM failed on all models (${plan.map((p) => p.model).join(", ")}): ${String(lastErr)}`,
  );
}

export interface CallLLMWithToolsOptions {
  system?: string;
  messages: Anthropic.MessageParam[];
  maxTokens?: number;
  temperature?: number;
  /** Model routing tier. Default `"smart"` for tool loops. */
  tier?: LlmTier;
  /** Short label for structured logs (e.g. "smart_answer"). */
  task?: string;
  tools: Anthropic.Tool[];
  toolExecutor: (name: string, input: unknown) => Promise<string>;
  /** Max assistant↔tool rounds before returning best text so far. Default 3. */
  maxRounds?: number;
}

function extractTextFromContent(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/**
 * Call the LLM with client-defined tools and a bounded tool-use loop.
 *
 * v1 does **not** combine Anthropic's server `web_search` tool here — custom
 * tools + brand data only. Prefer a clean client tool loop over mixing server tools.
 *
 * On max rounds, returns the best text so far or a short fallback (does not throw
 * solely for hitting the round cap).
 */
export async function callLLMWithTools(opts: CallLLMWithToolsOptions): Promise<string> {
  const env = getServerEnv();
  const tier: LlmTier = opts.tier ?? "smart";
  const plan = resolveModelPlan(tier, env);
  const started = Date.now();
  const maxRounds = opts.maxRounds ?? 3;

  let lastErr: unknown;
  let lastModel = plan[0]?.model ?? env.DRAFT_MODEL;

  for (const { model, retries } of plan) {
    lastModel = model;
    for (let i = 0; i < retries; i++) {
      try {
        const text = await attemptWithTools(model, opts, maxRounds);
        logLlmCall({
          task: opts.task,
          tier,
          model,
          ok: true,
          ms: Date.now() - started,
        });
        return text;
      } catch (err) {
        lastErr = err;
        const isVeryLastAttempt =
          model === plan[plan.length - 1]!.model && i === retries - 1;
        if (isVeryLastAttempt) break;
        await sleep(BASE_DELAY_MS * 2 ** i);
      }
    }
  }

  logLlmCall({
    task: opts.task,
    tier,
    model: lastModel,
    ok: false,
    ms: Date.now() - started,
  });

  throw new Error(
    `callLLMWithTools failed on all models (${plan.map((p) => p.model).join(", ")}): ${String(lastErr)}`,
  );
}

const TOOL_LOOP_FALLBACK =
  "I looked into that but hit my step limit — ask me again with a narrower question.";

async function attemptWithTools(
  model: string,
  opts: CallLLMWithToolsOptions,
  maxRounds: number,
): Promise<string> {
  const messages: Anthropic.MessageParam[] = opts.messages.map((m) => ({ ...m }));
  let bestText = "";

  for (let round = 0; round < maxRounds; round++) {
    const res = await getClient().messages.create({
      model,
      max_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature,
      system: opts.system,
      messages,
      tools: opts.tools,
    });

    const text = extractTextFromContent(res.content);
    if (text) bestText = text;

    const toolUses = res.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    if (!toolUses.length) {
      if (bestText) return bestText;
      throw new Error("LLM tool-loop response contained no text content");
    }

    messages.push({ role: "assistant", content: res.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      let result: string;
      try {
        result = await opts.toolExecutor(tu.name, tu.input);
      } catch (err) {
        result = JSON.stringify({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: result,
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return bestText || TOOL_LOOP_FALLBACK;
}
