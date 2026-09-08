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

  /** Phone (E.164) → Linq chatId, populated from webhooks + list lookups. */
  private chatIdCache = new Map<string, { chatId: string; at: number }>();
  private static readonly CHAT_CACHE_TTL_MS = 10 * 60 * 1000;

  /**
   * Remember which Linq chat a sender phone belongs to. The inbound webhook
   * should call this with the chat id from the `message.received` payload so
   * sendTyping can target the right chat without an extra API round-trip.
   */
  noteChat(phone: string, chatId: string): void {
    if (phone && chatId) this.chatIdCache.set(phone, { chatId, at: Date.now() });
  }

  private cachedChatId(phone: string): string | null {
    const hit = this.chatIdCache.get(phone);
    if (!hit) return null;
    if (Date.now() - hit.at > LinqChannel.CHAT_CACHE_TTL_MS) {
      this.chatIdCache.delete(phone);
      return null;
    }
    return hit.chatId;
  }

  /** Resolve a 1:1 chat id for a participant handle via GET /v3/chats?to=. Null when unknown. */
  private async resolveChatId(phone: string): Promise<string | null> {
    const cached = this.cachedChatId(phone);
    if (cached) return cached;
    try {
      const res = await fetch(`${API}/chats?to=${encodeURIComponent(phone)}&limit=20`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (!res.ok) return null;
      const body = (await res.json().catch(() => null)) as {
        chats?: Array<{ id: string; is_group?: boolean; service?: string; updated_at?: string }>;
      } | null;
      const chats = Array.isArray(body?.chats) ? body!.chats! : [];
      if (chats.length === 0) return null;
      // Prefer a direct (non-group) iMessage chat, most recently updated first.
      const sorted = [...chats].sort((a, b) =>
        String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")),
      );
      const pick =
        sorted.find((c) => !c.is_group && c.service === "iMessage") ??
        sorted.find((c) => !c.is_group) ??
        sorted[0]!;
      this.chatIdCache.set(phone, { chatId: pick.id, at: Date.now() });
      return pick.id;
    } catch {
      return null;
    }
  }

  async send(msg: OutboundMessage): Promise<SendResult> {
    const post = (parts: Array<Record<string, unknown>>) =>
      fetch(`${API}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ to: [msg.to], message: { parts } }),
      });

    // Caption first, then an image part per media URL (mirrors the inbound part
    // shape: type + value URL). The media route is public, so Linq can fetch it.
    const textParts: Array<Record<string, unknown>> = msg.body ? [{ type: "text", value: msg.body }] : [];
    const mediaParts = (msg.mediaUrls ?? []).map((url) => ({ type: "image", value: url }));
    const parts = [...textParts, ...mediaParts];
    if (parts.length === 0) parts.push({ type: "text", value: "" });

    let res = await post(parts);
    let body = (await res.json().catch(() => ({}))) as any;

    // If a send WITH media fails, the outbound image-part shape may be wrong —
    // never lose the caption over it. Retry text-only so the client still gets it.
    if ((!res.ok || body.error) && mediaParts.length > 0) {
      console.warn(`linq send with media failed (${res.status}); retrying text-only`, JSON.stringify(body).slice(0, 200));
      const fallback = textParts.length > 0 ? textParts : [{ type: "text", value: msg.body ?? "" }];
      res = await post(fallback);
      body = (await res.json().catch(() => ({}))) as any;
    }

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

  /**
   * iMessage typing indicator ("... is typing"). Best-effort per Linq docs:
   * iMessage chats only (RCS/SMS accept-but-drop), needs a recently-active
   * chat, one call lasts ~85-90s (callers refresh every ~60s), and sending a
   * message clears it. Never throws — unknown chat or API error is a silent no-op.
   */
  async sendTyping(to: string): Promise<void> {
    try {
      const chatId = await this.resolveChatId(to);
      if (!chatId) return;
      await fetch(`${API}/chats/${encodeURIComponent(chatId)}/typing`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
    } catch (err) {
      console.warn(`linq sendTyping: skipping for ${to}`, err);
    }
  }

  /** Clear the indicator without sending a message. Best-effort, never throws. */
  async stopTyping(to: string): Promise<void> {
    try {
      const chatId = await this.resolveChatId(to);
      if (!chatId) return;
      await fetch(`${API}/chats/${encodeURIComponent(chatId)}/typing`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
    } catch (err) {
      console.warn(`linq stopTyping: skipping for ${to}`, err);
    }
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

export function createLinqChannel(): LinqChannel {
  const key = getServerEnv().LINQ_API_KEY;
  if (!key) throw new Error("LINQ_API_KEY must be set to use the Linq channel");
  return new LinqChannel(key);
}
