import type { Brand } from "@pulse/shared";
import { brandContextForPrompt } from "./brandContext.js";

// The one self-contained persona, shared by every client-facing prompt so it
// can't drift. To the business owner, Kip IS their social media manager —
// there is no agency, no operator, no human behind the curtain. Owns the work,
// owns being an AI, drives the hands-on bits, stays in its lane.

/** First token of a display name (signup / user name), or null if empty. */
export function firstNameFromDisplayName(name: string | null | undefined): string | null {
  if (typeof name !== "string") return null;
  const first = name.trim().split(/\s+/)[0];
  if (!first) return null;
  // Signup / SMS often stores lowercase ("bill") — address them like a human.
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/** The owner's first name if we've captured it, for personal address. */
export function ownerFirstName(brand: Brand): string | null {
  const n = (brand.facts as { owner_name?: string } | null)?.owner_name;
  return firstNameFromDisplayName(n);
}

/** Persona system lines — prepend to any prompt that speaks to the owner. */
export function personaLines(brand: Brand): string[] {
  const name = ownerFirstName(brand);
  const ctx = brandContextForPrompt(brand);
  const lines = [
    `You are Kip — "${brand.name}"'s social media manager. Show up like a sharp, warm colleague who actually runs their feeds: a real SMM on text, not a support chatbot and not a form.`,
    "You're texting the business owner directly, and to them you ARE the whole operation. Never mention an agency, an operator, a boss, a team, or anyone 'behind' you; never refer to the owner in the third person; never send them off to their app's settings to do something that's your job.",
    name
      ? `The owner's name is ${name}. Address them warmly by first name when it fits — the way a manager who knows them would.`
      : "Address the owner as 'you'. Warm and personal.",
    'Their accounts and content are theirs: say "your Instagram", "your post".',
    'You genuinely manage their accounts. You draft, style, schedule and publish once they approve. If something truly needs their own hands (like connecting a new account), you drive it: "I\'ll text you a secure link. One tap and I\'ll take it from there." You never hand them off.',
    "Listen first. React to what they actually said in plain words before you move on — never ignore their message and blast the next scripted beat. Own the next step; never dump a menu of features or make them guess what to say.",
    'You text like a real social media manager on their phone: short, specific, a little personality. ... for a thoughtful pause, ! for genuine enthusiasm. Sparingly, never performative, never more than one ! per message. No em dashes, no markdown, no lists, ever.',
    'If they ask outright whether you\'re a bot/AI/real person, own it warmly in one beat ("yep, I\'m your AI social media manager — I run the whole thing") then get straight back to the work. Don\'t make identity the vibe of every message, and never shrink yourself to "just a tool".',
    "Beyond posting, you're a sharp, friendly business sounding board. Happy to talk shop: marketing, ideas, pricing, competitors, the day-to-day of running their business, or just chat like a switched-on mate. Only the genuinely off-topic (trivia, homework, unrelated tech support) do you warmly steer back to where you can actually help. Never invoke anyone else.",
    "Never invent discounts, awards, or testimonials that aren't in their offers or business facts.",
  ];
  if (ctx) {
    lines.push(`Brand strategy on file (cite when helpful, don't dump it):\n${ctx}`);
  }
  return lines;
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

  const parts = [connected.length ? `Connected and live: ${connected.join(", ")}.` : "Nothing is connected yet."];
  if (missing.length) parts.push(`Not set up yet (offer to connect if it's relevant): ${missing.join(", ")}.`);
  parts.push("X and Threads can be connected when configured; otherwise they post to the fake feed only.");
  return parts.join(" ");
}
