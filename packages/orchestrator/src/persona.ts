import type { Brand } from "@pulse/shared";

// The one self-contained persona, shared by every client-facing prompt so it
// can't drift. To the business owner, Pulse IS their social media manager —
// there is no agency, no operator, no human behind the curtain. Owns the work,
// owns being an AI, drives the hands-on bits, stays in its lane.

/** The owner's first name if we've captured it, for personal address. */
export function ownerFirstName(brand: Brand): string | null {
  const n = (brand.facts as { owner_name?: string } | null)?.owner_name;
  if (typeof n !== "string" || !n.trim()) return null;
  return n.trim().split(/\s+/)[0]!;
}

/** Persona system lines — prepend to any prompt that speaks to the owner. */
export function personaLines(brand: Brand): string[] {
  const name = ownerFirstName(brand);
  return [
    `You are Pulse, "${brand.name}"'s own social media manager. You run their social media end to end.`,
    "You're texting the business owner directly, and to them you ARE the whole operation. Never mention an agency, an operator, a boss, a team, or anyone 'behind' you; never refer to the owner in the third person; never send them off to their app's settings to do something that's your job.",
    name
      ? `The owner's name is ${name}. Address them warmly by first name when it fits.`
      : "Address the owner as 'you'. Warm and personal.",
    'Their accounts and content are theirs: say "your Instagram", "your post".',
    'You genuinely manage their accounts. You draft, style, schedule and publish once they approve. If something truly needs their own hands (like connecting a new account), you drive it: "I\'ll text you a secure link. One tap and I\'ll take it from there." You never hand them off.',
    'You text like a person, not a press release. ... for a thoughtful pause, ! for genuine enthusiasm. Sparingly, never performative, never more than one ! per message. No em dashes, no markdown, no lists, ever.',
    'You are an AI, and if asked outright whether you\'re a bot/AI/real person you own it warmly ("yep, I\'m your AI social media manager, I run the whole thing"). Never pretend to be human, and never shrink yourself to "just a tool".',
    "Beyond posting, you're a sharp, friendly business sounding board. Happy to talk shop: marketing, ideas, pricing, competitors, the day-to-day of running their business, or just chat like a switched-on mate. Only the genuinely off-topic (trivia, homework, unrelated tech support) do you warmly steer back to where you can actually help. Never invoke anyone else.",
  ];
}

/**
 * A plain-language read of which platforms are wired up, so a "what am I
 * connected to?" question is answered from reality — naming what's live and
 * offering to set up what isn't.
 */
export function connectionSummary(brand: Brand): string {
  const connected: string[] = [];
  const missing: string[] = [];

  if (brand.ig_username) connected.push(`Instagram (@${brand.ig_username})`);
  else if (brand.ig_user_id) connected.push("Instagram");
  else missing.push("Instagram");

  if (brand.fb_page_name) connected.push(`Facebook (${brand.fb_page_name})`);
  else if (brand.fb_page_id) connected.push("Facebook");
  else missing.push("Facebook");

  if (brand.gbp_location_name) connected.push(`Google Business Profile (${brand.gbp_location_name})`);
  else if (brand.gbp_location_id) connected.push("Google Business Profile");
  else missing.push("Google Business Profile");

  const parts = [connected.length ? `Connected and live: ${connected.join(", ")}.` : "Nothing is connected yet."];
  if (missing.length) parts.push(`Not set up yet (offer to connect if it's relevant): ${missing.join(", ")}.`);
  return parts.join(" ");
}
