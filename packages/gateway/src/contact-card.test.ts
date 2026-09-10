import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { buildKipVCard, foldVCardLine, resetServerEnvCache } from "@pulse/shared";
import { LinqChannel } from "./linq-channel.js";

describe("foldVCardLine", () => {
  it("leaves short lines alone", () => {
    expect(foldVCardLine("FN:Kip")).toBe("FN:Kip");
  });

  it("folds long lines with CRLF + space continuations", () => {
    const long = "PHOTO;ENCODING=b;TYPE=JPEG:" + "A".repeat(200);
    const folded = foldVCardLine(long);
    const lines = folded.split("\r\n");
    expect(lines[0]!.length).toBe(75);
    expect(lines[1]!.startsWith(" ")).toBe(true);
    expect(lines.every((l, i) => (i === 0 ? l.length <= 75 : l.length <= 75))).toBe(true);
  });
});

describe("buildKipVCard", () => {
  it("includes name, phone, and PHOTO URI", () => {
    const vcf = buildKipVCard({
      firstName: "Kip",
      phone: "+61400000000",
      imageUrl: "https://example.com/brand/kip-logo-1024.png",
      url: "https://example.com",
    });
    expect(vcf).toContain("BEGIN:VCARD");
    expect(vcf).toContain("FN:Kip");
    expect(vcf).toContain("TEL;TYPE=CELL,VOICE:+61400000000");
    expect(vcf).toContain("PHOTO;VALUE=URI:https://example.com/brand/kip-logo-1024.png");
    expect(vcf).toContain("END:VCARD");
  });

  it("embeds a JPEG photo when bytes are provided", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const vcf = buildKipVCard({ firstName: "Kip", phone: "+61400000000", photoJpeg: jpeg });
    expect(vcf).toContain("PHOTO;ENCODING=b;TYPE=JPEG:");
    expect(vcf).toContain(Buffer.from(jpeg).toString("base64"));
    expect(vcf).not.toContain("PHOTO;VALUE=URI:");
  });
});

describe("LinqChannel contact card", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/test";
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "test";
    process.env.TOKEN_ENCRYPTION_KEY =
      process.env.TOKEN_ENCRYPTION_KEY || Buffer.alloc(32).toString("base64");
    process.env.APP_BASE_URL = "https://kip.example";
    process.env.LINQ_FROM_NUMBER = "+61411111111";
    process.env.KIP_CONTACT_FIRST_NAME = "Kip";
    delete process.env.KIP_CONTACT_IMAGE_URL;
    resetServerEnvCache();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
    resetServerEnvCache();
  });

  it("shares the contact card after a successful send when chat_id is returned", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/messages") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            chat_id: "chat-abc",
            message: { id: "msg-1" },
          }),
          { status: 200 },
        );
      }
      if (u.includes("/contact_card") && (!init?.method || init.method === "GET")) {
        return new Response(
          JSON.stringify({
            contact_cards: [
              {
                phone_number: "+61411111111",
                first_name: "Kip",
                image_url: "https://kip.example/brand/kip-logo-1024.png",
                is_active: true,
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (u.endsWith("/share_contact_card") && init?.method === "POST") {
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify({ error: "unexpected " + u }), { status: 500 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const linq = new LinqChannel("test-key");
    const result = await linq.send({ to: "+61400000000", body: "Hey, it's Kip" });
    expect(result.providerMessageId).toBe("msg-1");

    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/share_contact_card"))).toBe(true);
    });
  });

  it("creates a contact card when none exists", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/contact_card") && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify({ error: { code: 2012 } }), { status: 404 });
      }
      if (u.endsWith("/contact_card") && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        expect(body.first_name).toBe("Kip");
        expect(body.phone_number).toBe("+61411111111");
        expect(body.image_url).toContain("kip-logo");
        return new Response(
          JSON.stringify({
            phone_number: body.phone_number,
            first_name: body.first_name,
            image_url: body.image_url,
            is_active: true,
          }),
          { status: 200 },
        );
      }
      return new Response("nope", { status: 500 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const linq = new LinqChannel("test-key");
    await expect(linq.ensureContactCard()).resolves.toBe(true);
  });
});
