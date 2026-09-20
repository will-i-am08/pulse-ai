import type { Brand, KipEvent } from "@pulse/shared";
import { speakSMS } from "./speak/index.js";

/**
 * Compose the warm "how'd it go?" follow-up for a passed event. Kept in its own
 * file so it can import the Speak pipeline without a cycle (speak/index imports
 * eventMemory for capture).
 */
export async function composeEventFollowupSms(brand: Brand, event: KipEvent): Promise<string> {
  const withWhom = event.entity ? ` (with ${event.entity})` : "";
  return speakSMS({
    brand,
    mode: "reengage",
    modeLines: [
      `The owner recently had this on: ${event.summary}${withWhom}${event.when_text ? ` — ${event.when_text}` : ""}.`,
      "You remembered it, unprompted. Open with a warm, brief check-in asking how it went — like a manager who was genuinely paying attention.",
      "One or two sentences, natural SMS tone. No lists, no menus. Don't pivot to selling them a post in the same breath.",
    ],
    userContent: `Ask the owner how this went: ${event.summary}${withWhom}.`,
    maxTokens: 200,
    think: false,
    // Proactive send with no owner message this turn — don't run the
    // open-loops / event-capture side effects.
    updateOpenLoops: false,
  });
}
