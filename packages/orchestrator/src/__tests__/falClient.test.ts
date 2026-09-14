import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  falGenerateImageRouted,
  FalAssetDownloadError,
  FAL_CONTROL_TIMEOUT_MS,
  FAL_ASSET_TIMEOUT_MS,
} from "../ugc/falClient.js";
import { STILL_MODELS } from "../ugc/modelRouter.js";

/**
 * falClient had zero coverage, which is why four bare fetches with no timeout
 * and a "paid for it then threw it away" asset path shipped. Every fetch here
 * is stubbed — this suite must never touch fal.ai.
 */

type Call = { url: string; init?: RequestInit };

const prevEnv = { ...process.env };
let calls: Call[] = [];
let submissions: string[] = [];

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  } as unknown as Response;
}

const chain = [STILL_MODELS.nano_banana, STILL_MODELS.flux_dev, STILL_MODELS.seedream];

describe("falClient transport (findings 3, 6, 12)", () => {
  beforeEach(() => {
    calls = [];
    submissions = [];
    process.env.FAL_KEY = "test-key";
  });

  afterEach(() => {
    process.env = { ...prevEnv };
    vi.restoreAllMocks();
  });

  it("puts an abort signal on every fetch — nothing may hang forever", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        if (String(url).startsWith("https://queue.fal.run/")) {
          return jsonResponse({ response_url: "https://fal.example/result" });
        }
        if (String(url) === "https://fal.example/result") {
          return jsonResponse({ images: [{ url: "https://cdn.example/a.jpg" }] });
        }
        return jsonResponse({});
      }),
    );

    await falGenerateImageRouted({ prompt: "p", chain: [STILL_MODELS.nano_banana] });

    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.init?.signal, `no timeout on ${c.url}`).toBeDefined();
    }
    expect(FAL_CONTROL_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
    expect(FAL_ASSET_TIMEOUT_MS).toBeGreaterThan(FAL_CONTROL_TIMEOUT_MS);
  });

  it("skips families that cannot carry product refs when refs are mandatory", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).startsWith("https://queue.fal.run/")) {
          submissions.push(String(url));
          return jsonResponse({}); // no response_url, no status_url → empty
        }
        return jsonResponse({});
      }),
    );

    await falGenerateImageRouted({
      prompt: "p",
      imageUrls: ["https://example.com/product.jpg"],
      requireImageRefs: true,
      chain,
    });

    // Flux Dev is text-to-image: submitting it would bill for a generic product
    // that is not the client's, quietly defeating the "send 1-3 product photos" gate.
    expect(submissions.some((u) => u.includes("flux"))).toBe(false);
    expect(submissions.some((u) => u.includes("nano-banana"))).toBe(true);
  });

  it("counts every billable submission via onSubmission", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).startsWith("https://queue.fal.run/")) return jsonResponse({});
        return jsonResponse({});
      }),
    );

    const seen: string[] = [];
    await falGenerateImageRouted({
      prompt: "p",
      chain,
      onSubmission: (falId) => seen.push(falId),
    });

    // All three models returned empty → three paid submissions for one scene.
    expect(seen).toHaveLength(3);
  });

  it("does not submit the next model when the asset download fails (finding 12)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.startsWith("https://queue.fal.run/")) {
          submissions.push(u);
          return jsonResponse({ response_url: "https://fal.example/result" });
        }
        if (u === "https://fal.example/result") {
          return jsonResponse({ images: [{ url: "https://cdn.example/a.jpg" }] });
        }
        // The CDN asset we have ALREADY PAID FOR.
        throw new Error("ECONNRESET");
      }),
    );

    await expect(
      falGenerateImageRouted({ prompt: "p", chain }),
    ).rejects.toBeInstanceOf(FalAssetDownloadError);

    // Previously ECONNRESET looked like a model failure: 3 paid submissions, null result.
    expect(submissions).toHaveLength(1);
  });

  it("retries the asset download before giving up", async () => {
    let assetAttempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.startsWith("https://queue.fal.run/")) {
          return jsonResponse({ response_url: "https://fal.example/result" });
        }
        if (u === "https://fal.example/result") {
          return jsonResponse({ images: [{ url: "https://cdn.example/a.jpg" }] });
        }
        assetAttempts += 1;
        if (assetAttempts < 2) throw new Error("ECONNRESET");
        return jsonResponse({});
      }),
    );

    const out = await falGenerateImageRouted({
      prompt: "p",
      chain: [STILL_MODELS.nano_banana],
    });

    expect(assetAttempts).toBe(2);
    expect(out?.modelId).toBe("nano_banana");
  });
});
