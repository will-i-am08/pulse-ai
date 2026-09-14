import { sanitizeChatText, type Brand } from "@pulse/shared";
import { speakSMS } from "./speak/index.js";

// Proactive nudges in Kip's own voice — never a dashboard alert. No quotes round
// the topic, no ratios, no "queue/pillar/planned" jargon. Just a mate texting.

function fallbackNudge(topic: string): string {
  const opts = [
    `Hey, we're a bit light on ${topic} this week. Got a photo I could use, or want me to put something together?`,
    `Could do with some ${topic} content this week. Fire over a snap whenever, or say the word and I'll draft one.`,
    `Running a little short on ${topic} lately. Anything you can send me, or shall I whip one up?`,
    `We haven't done much ${topic} this week. Got something to share, or want me to sort it?`,
  ];
  return opts[Math.floor(Math.random() * opts.length)]!;
}

/**
 * A warm, human nudge that a content area is running light. LLM-generated in the
 * brand's voice via Speak (style bank + anti-echo), with a human fallback if the
 * model call fails.
 */
export async function gapNudgeMessage(brand: Brand, pillarName: string): Promise<string> {
  const topic = pillarName.toLowerCase();
  try {
    const text = await speakSMS({
      brand,
      mode: "nudge",
      modeLines: [
        `You're a bit light on ${topic} content this week. Nudge the owner: ask if they've got a photo for it, or offer to draft something so they don't have to lift a finger.`,
        "Write ONE short, casual text, like you'd send a mate. Mention the topic naturally. No quotes around it, no numbers or ratios, no words like queue, pillar, planned or lined up. Under 25 words. At most one question.",
      ],
      userContent: "Write the nudge.",
      maxTokens: 120,
      think: false,
      updateOpenLoops: false,
    });
    const clean = sanitizeChatText(text).trim();
    if (clean) return clean;
  } catch {
    /* fall through to a human fallback */
  }
  return fallbackNudge(topic);
}
