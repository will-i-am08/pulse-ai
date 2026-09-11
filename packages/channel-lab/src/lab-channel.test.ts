import { describe, expect, it } from "vitest";
import { createLabChannel, storeLabMedia, labMediaStore } from "./lab-channel.js";

describe("LabChannel", () => {
  it("stores and fetches media once", async () => {
    const channel = createLabChannel();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const url = storeLabMedia(bytes, "image/png");
    expect(url.startsWith("lab://media/")).toBe(true);
    const fetched = await channel.fetchMedia({ url, contentType: "image/png" });
    expect(Array.from(fetched.bytes)).toEqual([1, 2, 3, 4]);
    expect(fetched.contentType).toBe("image/png");
    expect(labMediaStore.has(url)).toBe(false);
  });

  it("send returns a lab provider id", async () => {
    const channel = createLabChannel();
    const result = await channel.send({ to: "+15550000001", body: "hi" });
    expect(result.providerMessageId.startsWith("lab_")).toBe(true);
  });

  it("verifySignature always passes", () => {
    const channel = createLabChannel();
    expect(channel.verifySignature("http://x", {}, "sig")).toBe(true);
  });
});
