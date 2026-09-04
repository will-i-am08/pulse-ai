import {
  getServerEnv,
  type InboundMedia,
  type InboundMessage,
  type MessageChannel,
  type OutboundMessage,
  type SendResult,
} from "@pulse/shared";

// Linq (linqapp.com) messaging channel — iMessage/RCS/SMS. Send via the partner
// v3 API; inbound arrives as `message.received` webhooks (verified in the web
// route). See docs.linqapp.com.
const API = "https://api.linqapp.com/api/partner/v3";

export class LinqChannel implements MessageChannel {
  readonly name = "linq";
  constructor(private apiKey: string) {}

  async send(msg: OutboundMessage): Promise<SendResult> {
    // Text is reliable; media part shapes for outbound aren't documented in the
    // guide, so we send text only for now (the styled image is on the feed).
    const res = await fetch(`${API}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        to: [msg.to],
        message: { parts: [{ type: "text", value: msg.body }] },
      }),
    });
    const body = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || body.error) {
      throw new Error(`linq send ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
    }
    return { providerMessageId: String(body?.data?.id ?? body?.id ?? "linq_sent") };
  }

  /** Normalise a `message.received` webhook payload. */
  parseInbound(payload: unknown): InboundMessage {
    const p = payload as any;
    const data = p?.data ?? {};
    const parts: any[] = Array.isArray(data.parts) ? data.parts : [];
    const body = parts
      .filter((x) => x?.type === "text" && x?.value)
      .map((x) => x.value)
      .join(" ")
      .trim();
    const media: InboundMedia[] = parts
      .filter((x) => x?.type !== "text")
      .map((x) => ({ url: String(x?.url ?? x?.value ?? ""), contentType: String(x?.content_type ?? "image/jpeg") }))
      .filter((m) => /^https?:\/\//i.test(m.url));
    return {
      from: String(data?.sender_handle?.handle ?? ""),
      to: "",
      body,
      media,
      providerMessageId: String(data?.id ?? ""),
      raw: payload,
    };
  }

  /** Real verification (Svix-style headers + raw body) happens in the web route. */
  verifySignature(): boolean {
    return true;
  }

  async fetchMedia(media: InboundMedia): Promise<{ bytes: Uint8Array; contentType: string }> {
    const res = await fetch(media.url, { headers: { Authorization: `Bearer ${this.apiKey}` } });
    if (!res.ok) throw new Error(`LinqChannel.fetchMedia: ${res.status} ${res.statusText} for ${media.url}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    return { bytes: buf, contentType: res.headers.get("content-type") ?? media.contentType };
  }
}

export function createLinqChannel(): MessageChannel {
  const key = getServerEnv().LINQ_API_KEY;
  if (!key) throw new Error("LINQ_API_KEY must be set to use the Linq channel");
  return new LinqChannel(key);
}
