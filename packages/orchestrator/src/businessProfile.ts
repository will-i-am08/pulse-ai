import { query, type Brand, type BusinessFacts } from "@pulse/shared";
import { callLLM } from "./llm.js";

// The living business-facts profile: hours, prices, booking link, policies,
// FAQs. Powers auto-replies to customers and post generation. The
// owner edits it just by telling the agent ("we're open till 6 now").

const FACT_SIGNAL = /\b(hour|open|clos|price|cost|\$|book|appointment|address|located|deliver|refund|policy|faq|menu|we (offer|sell|do)|our (hours|prices|address)|my name|call me|name'?s|i'?m\s+[a-z]+)\b/i;

/** Does this owner message look like it's stating business facts? */
export function looksLikeBusinessFact(body: string | null | undefined): boolean {
  return Boolean(body && FACT_SIGNAL.test(body));
}

function mergeFacts(existing: BusinessFacts, incoming: BusinessFacts): BusinessFacts {
  const out: BusinessFacts = { ...existing };
  const keyOf = (field: string, item: unknown): string => {
    const rec = (item ?? {}) as Record<string, unknown>;
    if (field === "services") return String(rec.name ?? "").toLowerCase().trim();
    if (field === "faqs") return String(rec.q ?? "").toLowerCase().trim();
    return JSON.stringify(item);
  };
  for (const [k, v] of Object.entries(incoming) as Array<[keyof BusinessFacts, unknown]>) {
    if (v == null || v === "") continue;
    if (Array.isArray(v)) {
      // Merge by key so an updated service/FAQ REPLACES the old one (a price change
      // must not leave two contradictory entries for the reply engine).
      const prev = Array.isArray(out[k]) ? (out[k] as unknown[]) : [];
      const map = new Map<string, unknown>();
      for (const item of prev) map.set(keyOf(k, item), item);
      for (const item of v) map.set(keyOf(k, item), item);
      (out as Record<string, unknown>)[k] = [...map.values()];
    } else {
      (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

/**
 * Extract business facts from an owner message and merge them into the profile.
 * Returns a confirmation string, or null if the message states no facts (so the
 * caller can fall through to normal handling).
 */
export async function updateFactsFromMessage(brand: Brand, message: string): Promise<string | null> {
  const system = [
    "Extract any concrete business facts stated in the message into JSON.",
    'Shape: {"owner_name":"","hours":"","address":"","service_area":"","services":[{"name":"","price":""}],"booking_link":"","policies":"","faqs":[{"q":"","a":""}],"differentiators":""}',
    'Set "owner_name" only if the person states their OWN name (e.g. "I\'m Sarah", "my name\'s Tom"). First name only.',
    "Include ONLY fields the message actually states; omit everything else. If it states no facts, output exactly {}.",
    'Also return a "reply" field: one short friendly sentence confirming what you saved.',
    'Wrap as {"facts":{...},"reply":"..."}.',
  ].join("\n");
  let parsed: { facts?: BusinessFacts; reply?: string };
  try {
    const raw = await callLLM({ system, messages: [{ role: "user", content: message }], maxTokens: 400 });
    parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  } catch {
    return null;
  }
  const incoming = parsed.facts ?? {};
  if (!incoming || Object.keys(incoming).length === 0) return null;

  const merged = mergeFacts(brand.facts ?? {}, incoming);
  await query(`update brands set facts = $1::jsonb where id = $2`, [JSON.stringify(merged), brand.id]);
  return parsed.reply?.trim() || "Got it, I've updated your business details.";
}

/** A compact, readable summary of the profile for prompting the reply engine. */
export function factsForPrompt(facts: BusinessFacts | null | undefined): string {
  if (!facts) return "(no business details on file yet)";
  const lines: string[] = [];
  if (facts.hours) lines.push(`Hours: ${facts.hours}`);
  if (facts.address) lines.push(`Address: ${facts.address}`);
  if (facts.service_area) lines.push(`Service area: ${facts.service_area}`);
  if (facts.services?.length) lines.push(`Services/prices: ${facts.services.map((s) => `${s.name}${s.price ? ` (${s.price})` : ""}`).join(", ")}`);
  if (facts.booking_link) lines.push(`Booking: ${facts.booking_link}`);
  if (facts.policies) lines.push(`Policies: ${facts.policies}`);
  if (facts.differentiators) lines.push(`About: ${facts.differentiators}`);
  if (facts.faqs?.length) lines.push(`FAQs:\n${facts.faqs.map((f) => `- ${f.q} → ${f.a}`).join("\n")}`);
  return lines.length ? lines.join("\n") : "(no business details on file yet)";
}
