import twilio from "twilio";
import {
  getServerEnv,
  type InboundMedia,
  type InboundMessage,
  type MessageChannel,
  type OutboundMessage,
  type SendResult,
} from "@pulse/shared";

// Twilio's inbound webhook body is application/x-www-form-urlencoded. By the
// time it reaches parseInbound it has already been decoded into a plain
// string-keyed object (by whatever HTTP framework apps/web uses) — we treat
// `payload` as that decoded record.
type TwilioWebhookPayload = Record<string, string | undefined>;

/** Basic-auth for the Twilio REST SDK (sending). Prefer revocable API keys. */
function restCreds(): { user: string; pass: string; accountSid: string } {
  const env = getServerEnv();
  if (!env.TWILIO_ACCOUNT_SID) {
    throw new Error("TWILIO_ACCOUNT_SID must be set to use TwilioChannel");
  }
  if (env.TWILIO_API_KEY_SID && env.TWILIO_API_KEY_SECRET) {
    return { user: env.TWILIO_API_KEY_SID, pass: env.TWILIO_API_KEY_SECRET, accountSid: env.TWILIO_ACCOUNT_SID };
  }
  if (env.TWILIO_AUTH_TOKEN) {
    return { user: env.TWILIO_ACCOUNT_SID, pass: env.TWILIO_AUTH_TOKEN, accountSid: env.TWILIO_ACCOUNT_SID };
  }
  throw new Error(
    "Provide TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET (preferred) or TWILIO_AUTH_TOKEN to use TwilioChannel",
  );
}

/**
 * Auth pairs to try for media downloads. Account SID + Auth Token first —
 * media CDN redirects are most reliable with that pair — then API key.
 */
function mediaAuthCandidates(): Array<{ user: string; pass: string }> {
  const env = getServerEnv();
  if (!env.TWILIO_ACCOUNT_SID) {
    throw new Error("TWILIO_ACCOUNT_SID must be set to use TwilioChannel");
  }
  const out: Array<{ user: string; pass: string }> = [];
  if (env.TWILIO_AUTH_TOKEN) {
    out.push({ user: env.TWILIO_ACCOUNT_SID, pass: env.TWILIO_AUTH_TOKEN });
  }
  if (env.TWILIO_API_KEY_SID && env.TWILIO_API_KEY_SECRET) {
    out.push({ user: env.TWILIO_API_KEY_SID, pass: env.TWILIO_API_KEY_SECRET });
  }
  if (out.length === 0) {
    throw new Error(
      "Provide TWILIO_AUTH_TOKEN or TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET to download media",
    );
  }
  return out;
}

/** Collect MediaUrl{N} entries from a Twilio webhook, even if NumMedia is wrong. */
export function mediaFromTwilioPayload(p: Record<string, string | undefined>): InboundMedia[] {
  const media: InboundMedia[] = [];
  const seen = new Set<string>();
  const numMedia = Number.parseInt(p.NumMedia ?? "0", 10) || 0;
  const maxIdx = Math.max(numMedia, 10);
  for (let i = 0; i < maxIdx; i++) {
    const url = p[`MediaUrl${i}`];
    if (!url || seen.has(url)) continue;
    seen.add(url);
    media.push({
      url,
      contentType: p[`MediaContentType${i}`] ?? "application/octet-stream",
    });
  }
  // Also pick up any MediaUrl* keys NumMedia under-counted.
  for (const [key, url] of Object.entries(p)) {
    const m = /^MediaUrl(\d+)$/i.exec(key);
    if (!m || !url || seen.has(url)) continue;
    seen.add(url);
    const idx = m[1]!;
    media.push({
      url,
      contentType: p[`MediaContentType${idx}`] ?? "application/octet-stream",
    });
  }
  return media;
}

export class TwilioChannel implements MessageChannel {
  readonly name = "twilio-sms";

  private clientCache: ReturnType<typeof twilio> | null = null;

  private client(): ReturnType<typeof twilio> {
    if (this.clientCache) return this.clientCache;
    const { user, pass, accountSid } = restCreds();
    // When `user` is an API key SID, the SDK needs the account SID passed explicitly.
    // Cap request time so a hung Twilio call can't stall the inbound pipeline (~30s default).
    this.clientCache = twilio(user, pass, { accountSid, timeout: 15_000 });
    return this.clientCache;
  }

  async send(msg: OutboundMessage): Promise<SendResult> {
    const env = getServerEnv();
    if (!env.TWILIO_FROM_NUMBER) {
      throw new Error("TWILIO_FROM_NUMBER must be set to send messages via TwilioChannel");
    }
    const payload = {
      to: msg.to,
      from: env.TWILIO_FROM_NUMBER,
      body: msg.body,
      ...(msg.mediaUrls && msg.mediaUrls.length > 0 ? { mediaUrl: msg.mediaUrls } : {}),
    };
    // No retry here. Per the MessageChannel contract, retries/backoff are the
    // caller's concern (gateway.sendToBrand wraps this in withBackoff). Retrying
    // internally multiplied with that wrapper: one client-side timeout became up
    // to six messages.create calls — and a timeout does NOT mean Twilio rejected
    // the send, it commonly accepts and queues, so each extra attempt is a
    // separately billed, separately delivered duplicate SMS.
    const message = await this.client().messages.create(payload);
    return { providerMessageId: message.sid };
  }

  parseInbound(payload: unknown): InboundMessage {
    const p = (payload ?? {}) as TwilioWebhookPayload;
    return {
      from: p.From ?? "",
      to: p.To ?? "",
      body: p.Body ?? "",
      media: mediaFromTwilioPayload(p),
      providerMessageId: p.MessageSid ?? p.SmsSid ?? "",
      raw: payload,
    };
  }

  verifySignature(url: string, params: Record<string, string>, signature: string): boolean {
    // Twilio signs webhooks with the account Auth Token only — an API key secret
    // cannot validate the X-Twilio-Signature header, so this always needs the token.
    const env = getServerEnv();
    if (!env.TWILIO_AUTH_TOKEN) return false;
    return twilio.validateRequest(env.TWILIO_AUTH_TOKEN, signature, url, params);
  }

  async fetchMedia(media: InboundMedia): Promise<{ bytes: Uint8Array; contentType: string }> {
    let lastErr: Error | null = null;
    for (const { user, pass } of mediaAuthCandidates()) {
      try {
        return await downloadTwilioMedia(media.url, user, pass, media.contentType);
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
      }
    }
    throw lastErr ?? new Error(`TwilioChannel.fetchMedia: failed to download media: ${media.url}`);
  }

  /**
   * Recover media when the inbound webhook omitted NumMedia/MediaUrl* but Twilio
   * still has attachments on the Message resource (common with flaky MMS).
   */
  async listMessageMedia(providerMessageId: string): Promise<InboundMedia[]> {
    const sid = providerMessageId?.trim();
    if (!sid || !/^(SM|MM)[a-f0-9]{32}$/i.test(sid)) return [];
    try {
      const { accountSid } = restCreds();
      const list = await this.client().messages(sid).media.list({ limit: 10 });
      return list.map((m) => ({
        url: `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${sid}/Media/${m.sid}`,
        contentType: m.contentType || "application/octet-stream",
      }));
    } catch (err) {
      console.warn(`TwilioChannel.listMessageMedia: failed for ${sid}`, err);
      return [];
    }
  }
}

/**
 * Download Twilio media, following the auth→signed-CDN redirect without relying
 * on fetch to keep the Authorization header across hosts (it must not).
 */
async function downloadTwilioMedia(
  url: string,
  user: string,
  pass: string,
  fallbackType: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const auth = Buffer.from(`${user}:${pass}`).toString("base64");
  const first = await fetch(url, {
    headers: { Authorization: `Basic ${auth}` },
    redirect: "manual",
  });
  let res = first;
  if (first.status >= 300 && first.status < 400) {
    const loc = first.headers.get("location");
    if (!loc) {
      throw new Error(`TwilioChannel.fetchMedia: redirect without Location (${first.status}): ${url}`);
    }
    // Signed CDN URL — no auth header.
    res = await fetch(loc, { redirect: "follow" });
  }
  if (!res.ok) {
    throw new Error(
      `TwilioChannel.fetchMedia: failed to download media (${res.status} ${res.statusText}): ${url}`,
    );
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") ?? fallbackType;
  return { bytes: buf, contentType };
}

export function createTwilioChannel(): MessageChannel {
  return new TwilioChannel();
}
