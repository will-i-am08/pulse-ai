import { describe, it, expect } from "vitest";
import { sanitizeChatText, isChatClean } from "@pulse/shared";

describe("sanitizeChatText", () => {
  it("turns em dashes into commas", () => {
    expect(sanitizeChatText("Got it — styling your photo")).toBe("Got it, styling your photo");
  });

  it("turns en dashes into commas", () => {
    expect(sanitizeChatText("Tone — direct, no fluff")).toBe("Tone, direct, no fluff");
  });

  it("drops edge dashes instead of leaving stray commas", () => {
    expect(sanitizeChatText("— Hello")).toBe("Hello");
    expect(sanitizeChatText("Hello —")).toBe("Hello");
  });

  it("strips markdown bold and italics", () => {
    expect(sanitizeChatText('**Quick one:** what does that mean?')).toBe("Quick one: what does that mean?");
    expect(sanitizeChatText("say *hi* back")).toBe("say hi back");
  });

  it("leaves clean text untouched", () => {
    const clean = "Hey William! Send me a photo anytime and we'll get rolling.";
    expect(sanitizeChatText(clean)).toBe(clean);
  });

  it("folds spaced hyphens into commas", () => {
    expect(sanitizeChatText("mindset stuff - are you grind or smart")).toBe(
      "mindset stuff, are you grind or smart",
    );
  });

  it("leaves bullets and hyphenated words alone", () => {
    expect(sanitizeChatText("- first\n- second")).toBe("- first\n- second");
    expect(sanitizeChatText("well-known micro-SaaS tips")).toBe("well-known micro-SaaS tips");
  });

  it("lets ellipses and exclamations through", () => {
    expect(sanitizeChatText("Hmm... interesting! Tell me more!")).toBe("Hmm... interesting! Tell me more!");
  });
});

describe("isChatClean", () => {
  it("rejects dashes and markdown, accepts the rest", () => {
    expect(isChatClean("no — way")).toBe(false);
    expect(isChatClean("a – b")).toBe(false);
    expect(isChatClean("**bold** move")).toBe(false);
    expect(isChatClean("Clean, plain text.")).toBe(true);
  });
});
