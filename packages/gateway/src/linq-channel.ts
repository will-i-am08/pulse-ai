import {
  getServerEnv,
  kipContactIdentity,
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

type ContactCard = {
  phone_number: string;
  first_name: string;
  last_name?: string | null;
  image_url?: string | null;
  is_active: boolean;
};

export class LinqChannel implements MessageChannel {
  readonly name = "linq";
  constructor(private apiKey: string) {}

  /** Phone (E.164) → Linq chatId, populated from webhooks + list lookups. */
  private chatIdCache = new Map<string, { chatId: string; at: number }>();
  private static readonly CHAT_CACHE_TTL_MS = 10 * 60 * 1000;

  /** chatId → last successful share_contact_card timestamp (once/day per Linq docs). */
  private shareCache = new Map<string, number>();
  private static readonly SHARE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

  /** Lazily ensure Kip's contact card exists on the sending line (once per process). */
  private contactCardReady: Promise<boolean> | null = null;

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

  private authHeaders(json = false): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      ...(json ? { "Content-Type": "application/json" } : {}),
    };
  }

  /** Resolve Kip's contact-card identity from env (name + public profile image). */
  contactIdentity(): { phone: string | undefined; firstName: string; imageUrl: string } {
    const id = kipContactIdentity();
    // Prefer the dedicated Linq line when set; otherwise fall back to shared identity phone.
    return {
      phone: getServerEnv().LINQ_FROM_NUMBER ?? id.phone,
      firstName: id.firstName,
      imageUrl: id.imageUrl,
    };
  }

  /** Resolve a 1:1 chat id for a participant handle via GET /v3/chats?to=. Null when unknown. */
  private async resolveChatId(phone: string): Promise<string | null> {
    const cached = this.cachedChatId(phone);
    if (cached) return cached;
    try {
      const res = await fetch(`${API}/chats?to=${encodeURIComponent(phone)}&limit=20`, {
        headers: this.authHeaders(),
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

  /**
   * Configure Kip's iMessage contact card on the Linq sending number (name +
   * profile photo). Idempotent: creates if missing, patches if the name/image
   * drifted. Does not share into any chat — call shareContactCard for that.
   * Returns true when an active card is ready.
   */
  async ensureContactCard(): Promise<boolean> {
    if (!this.contactCardReady) {
      this.contactCardReady = this.ensureContactCardOnce().catch((err) => {
        // Allow a later send to retry after a transient failure.
        this.contactCardReady = null;
        console.warn("linq ensureContactCard failed", err);
        return false;
      });
    }
    return this.contactCardReady;
  }

  private async ensureContactCardOnce(): Promise<boolean> {
    const { phone, firstName, imageUrl } = this.contactIdentity();
    if (!phone) {
      console.warn(
        "linq ensureContactCard: LINQ_FROM_NUMBER unset — Kip will appear as a bare number until configured",
      );
      return false;
    }

    const existing = await this.retrieveContactCard(phone);
    if (existing?.is_active && existing.first_name === firstName && (existing.image_url ?? "") === imageUrl) {
      return true;
    }

    if (!existing) {
      const created = await this.createContactCard({
        phone_number: phone,
        first_name: firstName,
        image_url: imageUrl,
      });
      if (created?.is_active) return true;
      // 409 = already exists (race / prior setup) — fall through to patch.
      if (!created) {
        const again = await this.retrieveContactCard(phone);
        if (again?.is_active && again.first_name === firstName && (again.image_url ?? "") === imageUrl) {
          return true;
        }
      }
    }

    const updated = await this.updateContactCard(phone, {
      first_name: firstName,
      image_url: imageUrl,
    });
    if (updated?.is_active) return true;
    console.warn(
      `linq ensureContactCard: card for ${phone} is not active yet — share will wait until Linq finishes applying it`,
    );
    return false;
  }

  private async retrieveContactCard(phone: string): Promise<ContactCard | null> {
    const res = await fetch(`${API}/contact_card?phone_number=${encodeURIComponent(phone)}`, {
      headers: this.authHeaders(),
    });
    if (res.status === 404) return null;
    const body = (await res.json().catch(() => null)) as {
      contact_cards?: ContactCard[];
      error?: { code?: number };
    } | null;
    // 2012 = no card for this number.
    if (!res.ok) {
      if (body?.error?.code === 2012 || res.status === 404) return null;
      console.warn(`linq retrieveContactCard ${res.status}`, JSON.stringify(body).slice(0, 200));
      return null;
    }
    const cards = Array.isArray(body?.contact_cards) ? body!.contact_cards! : [];
    return cards.find((c) => c.phone_number === phone) ?? cards[0] ?? null;
  }

  private async createContactCard(input: {
    phone_number: string;
    first_name: string;
    image_url: string;
  }): Promise<ContactCard | null> {
    const res = await fetch(`${API}/contact_card`, {
      method: "POST",
      headers: this.authHeaders(true),
      body: JSON.stringify(input),
    });
    const body = (await res.json().catch(() => null)) as (ContactCard & { error?: { code?: number } }) | null;
    // 409 / 2014 = card already exists — caller should patch.
    if (res.status === 409 || body?.error?.code === 2014) return null;
    if (!res.ok) {
      console.warn(`linq createContactCard ${res.status}`, JSON.stringify(body).slice(0, 200));
      return null;
    }
    return body && typeof body.phone_number === "string" ? body : null;
  }

  private async updateContactCard(
    phone: string,
    patch: { first_name: string; image_url: string },
  ): Promise<ContactCard | null> {
    const res = await fetch(`${API}/contact_card?phone_number=${encodeURIComponent(phone)}`, {
      method: "PATCH",
      headers: this.authHeaders(true),
      body: JSON.stringify(patch),
    });
    const body = (await res.json().catch(() => null)) as ContactCard | null;
    if (!res.ok) {
      console.warn(`linq updateContactCard ${res.status}`, JSON.stringify(body).slice(0, 200));
      return null;
    }
    return body && typeof body.phone_number === "string" ? body : null;
  }

  /**
   * Push Kip's contact card into a chat (iMessage Name and Photo Sharing).
   * Best-effort, never throws. Requires a prior outbound message and an active
   * card. Safe to call once per day per chat (Linq recommendation).
   */
  async shareContactCard(chatId: string | null | undefined): Promise<void> {
    if (!chatId) return;
    const last = this.shareCache.get(chatId) ?? 0;
    if (Date.now() - last < LinqChannel.SHARE_COOLDOWN_MS) return;

    const ready = await this.ensureContactCard();
    if (!ready) return;

    try {
      const res = await fetch(`${API}/chats/${encodeURIComponent(chatId)}/share_contact_card`, {
        method: "POST",
        headers: this.authHeaders(),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.warn(`linq shareContactCard ${res.status} for ${chatId}`, body.slice(0, 200));
        return;
      }
      this.shareCache.set(chatId, Date.now());
    } catch (err) {
      console.warn(`linq shareContactCard: skipping for ${chatId}`, err);
    }
  }

  async send(msg: OutboundMessage): Promise<SendResult> {
    const post = (parts: Array<Record<string, unknown>>) =>
      fetch(`${API}/messages`, {
        method: "POST",
        headers: this.authHeaders(true),
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

    // Cache the chat from the send response so typing + contact-card share can
    // target it without an extra list round-trip (works for first outbound too).
    const chatId = String(body?.chat_id ?? body?.data?.chat_id ?? "") || null;
    if (chatId) this.noteChat(msg.to, chatId);

    // After the first outbound in a chat, share Kip's name + profile photo so
    // iMessage prompts "Kip" instead of a raw +61… number. Fire-and-forget.
    void this.shareContactCard(chatId).catch((err) =>
      console.warn(`linq shareContactCard after send failed for ${msg.to}`, err),
    );

    return { providerMessageId: String(body?.message?.id ?? body?.data?.id ?? body?.id ?? "linq_sent") };
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
        headers: this.authHeaders(),
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
        headers: this.authHeaders(),
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
    const res = await fetch(media.url, { headers: this.authHeaders() });
    if (!res.ok) throw new Error(`LinqChannel.fetchMedia: ${res.status} ${res.statusText} for ${media.url}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    return { bytes: buf, contentType: res.headers.get("content-type") ?? media.contentType };
  }
}

export function createLinqChannel(): LinqChannel {
  const key = getServerEnv().LINQ_API_KEY;
  if (!key) throw new Error("LINQ_API_KEY must be set to use the Linq channel");
  const channel = new LinqChannel(key);
  // Warm the contact card at process start so the first OTP/onboarding text can
  // share "Kip" + the cat logo immediately after that outbound lands.
  void channel.ensureContactCard();
  return channel;
}
