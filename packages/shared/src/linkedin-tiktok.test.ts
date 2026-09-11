import { describe, it, expect, afterEach } from "vitest";
import {
  linkedinBuildPostBody,
  linkedinMapError,
  tiktokBuildDirectPostBody,
  tiktokEnforcePrivacy,
  tiktokMapError,
  DEFAULT_TIKTOK_PRIVACY,
  tiktokAuditPassed,
} from "./index.js";

describe("linkedin live shapes + errors", () => {
  it("builds text/image/multi/video Posts API bodies", () => {
    expect(linkedinBuildPostBody({ orgId: "1", accessToken: "t", commentary: "hi" }).commentary).toBe(
      "hi",
    );
    expect(
      linkedinBuildPostBody({
        orgId: "1",
        accessToken: "t",
        commentary: "p",
        mediaUrls: ["https://x/a.jpg"],
      })._kip_media_kind,
    ).toBe("image");
    expect(
      linkedinBuildPostBody({
        orgId: "1",
        accessToken: "t",
        commentary: "p",
        mediaUrls: ["https://x/a.jpg", "https://x/b.jpg"],
      })._kip_media_kind,
    ).toBe("multi_image");
    expect(
      linkedinBuildPostBody({
        orgId: "1",
        accessToken: "t",
        commentary: "p",
        mediaUrls: ["https://x/v.mp4"],
      })._kip_media_kind,
    ).toBe("video");
  });

  it("maps admin and partner approval errors", () => {
    expect(linkedinMapError("ACCESS_DENIED organization admin required")).toMatch(/admin/i);
    expect(linkedinMapError("developer application partner not approved")).toMatch(/partner/i);
  });
});

describe("tiktok audit + AIGC + caps", () => {
  afterEach(() => {
    delete process.env.TIKTOK_AUDIT_PASSED;
  });

  it("forces SELF_ONLY without TIKTOK_AUDIT_PASSED", () => {
    delete process.env.TIKTOK_AUDIT_PASSED;
    expect(tiktokAuditPassed()).toBe(false);
    expect(
      tiktokEnforcePrivacy({ ...DEFAULT_TIKTOK_PRIVACY, privacy_level: "PUBLIC_TO_EVERYONE" })
        .privacy_level,
    ).toBe("SELF_ONLY");
  });

  it("keeps public privacy when audited", () => {
    process.env.TIKTOK_AUDIT_PASSED = "true";
    expect(
      tiktokEnforcePrivacy({ ...DEFAULT_TIKTOK_PRIVACY, privacy_level: "PUBLIC_TO_EVERYONE" })
        .privacy_level,
    ).toBe("PUBLIC_TO_EVERYONE");
  });

  it("sets is_aigc only when aigc input is true", () => {
    const withAi = tiktokBuildDirectPostBody({
      accessToken: "t",
      title: "ai",
      mediaUrls: ["https://x/v.mp4"],
      privacy: { ...DEFAULT_TIKTOK_PRIVACY, music_usage_confirmed: true },
      aigc: true,
    });
    expect((withAi.body.post_info as { is_aigc?: boolean }).is_aigc).toBe(true);

    const without = tiktokBuildDirectPostBody({
      accessToken: "t",
      title: "organic",
      mediaUrls: ["https://x/v.mp4"],
      privacy: { ...DEFAULT_TIKTOK_PRIVACY, music_usage_confirmed: true, aigc_disclosure: true },
      aigc: false,
    });
    expect((without.body.post_info as { is_aigc?: boolean }).is_aigc).toBeUndefined();
  });

  it("maps rate/cap and caption errors", () => {
    expect(tiktokMapError("caption too long")).toMatch(/2200/);
    expect(tiktokMapError("rate limit exceeded")).toMatch(/rate\/cap/);
  });
});
