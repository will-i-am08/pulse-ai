import type { Interaction, InteractionKind } from "@pulse/shared";

/**
 * Stable Phase I lead-card JSON (I2). Field names are part of the CRM contract —
 * do not rename without a version bump.
 */
export interface LeadCard {
  handle: string | null;
  platform: string;
  channel: InteractionKind;
  intent: string | null;
  summary: string | null;
  next_step: string | null;
  permalink: string | null;
  timestamp: string;
  /** Helpful CRM extras (stable additive keys). */
  interaction_id: string;
  brand_id: string;
  brand_name?: string;
  text?: string | null;
}

export type LeadCardInput = {
  interaction: Interaction;
  brandId: string;
  brandName?: string;
  intent?: string | null;
  summary?: string | null;
  next_step?: string | null;
  permalink?: string | null;
  timestamp?: string;
};

const INTENT_PATTERNS: Array<{ re: RegExp; intent: string }> = [
  { re: /\b(book|booking|appoint(ment)?|reserv(e|ation)|schedule)\b/i, intent: "book" },
  { re: /\b(buy|purchase|order|checkout|add to cart)\b/i, intent: "buy" },
  { re: /\b(quote|estimat(e|ing)|how much|pricing|price)\b/i, intent: "quote" },
  { re: /\b(call|phone|ring|speak (to|with)|talk (to|with))\b/i, intent: "call" },
  { re: /\b(dm|message|chat|reach out)\b/i, intent: "message" },
];

/** Infer a short intent label from free text / summary. */
export function inferLeadIntent(text: string | null | undefined, summary?: string | null): string | null {
  const blob = `${summary ?? ""} ${text ?? ""}`.trim();
  if (!blob) return null;
  for (const { re, intent } of INTENT_PATTERNS) {
    if (re.test(blob)) return intent;
  }
  return "inquiry";
}

/** Suggest a concrete next step for the owner. */
export function suggestLeadNextStep(intent: string | null, channel: InteractionKind): string {
  switch (intent) {
    case "book":
      return "Reply with availability or your booking link.";
    case "buy":
      return "Send product/link details and confirm stock.";
    case "quote":
      return "Send a quote or ask for the details you need.";
    case "call":
      return "Call them back or text a time that works.";
    case "message":
      return channel === "dm" ? "Continue the DM thread." : "Move the conversation to DMs.";
    default:
      return "Follow up while interest is warm.";
  }
}

/** Build the stable lead-card object. */
export function buildLeadCard(input: LeadCardInput): LeadCard {
  const { interaction } = input;
  const intent =
    input.intent !== undefined ? input.intent : inferLeadIntent(interaction.text, input.summary);
  const next_step =
    input.next_step !== undefined
      ? input.next_step
      : suggestLeadNextStep(intent, interaction.kind);
  const permalink =
    input.permalink !== undefined
      ? input.permalink
      : ((interaction as Interaction & { permalink?: string | null }).permalink ?? null);

  return {
    handle: interaction.author ?? null,
    platform: interaction.platform,
    channel: interaction.kind,
    intent,
    summary: input.summary ?? null,
    next_step,
    permalink,
    timestamp: input.timestamp ?? interaction.created_at ?? new Date().toISOString(),
    interaction_id: interaction.id,
    brand_id: input.brandId,
    brand_name: input.brandName,
    text: interaction.text ?? null,
  };
}

/** Owner-facing SMS rendering of a lead card. */
export function formatLeadCardSms(card: LeadCard): string {
  const who = card.handle ? card.handle : "someone";
  const where = `${card.channel} on ${card.platform}`;
  const lines = [
    `🔥 Lead card — ${who} · ${where}`,
    card.intent ? `Intent: ${card.intent}` : null,
    card.summary ? `Summary: ${card.summary}` : null,
    card.text ? `They said: "${card.text}"` : null,
    card.next_step ? `Next: ${card.next_step}` : null,
    card.permalink ? card.permalink : null,
  ];
  return lines.filter(Boolean).join("\n");
}
