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

/** Basic-auth pair for REST + media downloads: prefer the API key, fall back to the Auth Token. */
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

export class TwilioChannel implements MessageChannel {
  readonly name = "twilio-sms";

  private clientCache: ReturnType<typeof twilio> | null = null;

  private client(): ReturnType<typeof twilio> {
    if (this.clientCache) return this.clientCache;
    const { user, pass, accountSid } = restCreds();
    // When `user` is an API key SID, the SDK needs the account SID passed explicitly.
    this.clientCache = twilio(user, pass, { accountSid });
    return this.clientCache;
  }

  async send(msg: OutboundMessage): Promise<SendResult> {
    const env = getServerEnv();
    if (!env.TWILIO_FROM_NUMBER) {
      throw new Error("TWILIO_FROM_NUMBER must be set to send messages via TwilioChannel");
    }
    const message = await this.client().messages.create({
      to: msg.to,
      from: env.TWILIO_FROM_NUMBER,
      body: msg.body,
      ...(msg.mediaUrls && msg.mediaUrls.length > 0 ? { mediaUrl: msg.mediaUrls } : {}),
    });
    return { providerMessageId: message.sid };
  }

  parseInbound(payload: unknown): InboundMessage {
    const p = (payload ?? {}) as TwilioWebhookPayload;
    const numMedia = Number.parseInt(p.NumMedia ?? "0", 10) || 0;

    const media: InboundMedia[] = [];
    for (let i = 0; i < numMedia; i++) {
      const url = p[`MediaUrl${i}`];
      if (!url) continue;
      media.push({
        url,
        contentType: p[`MediaContentType${i}`] ?? "application/octet-stream",
      });
    }

    return {
      from: p.From ?? "",
      to: p.To ?? "",
      body: p.Body ?? "",
      media,
      providerMessageId: p.MessageSid ?? "",
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
    const { user, pass } = restCreds();
    const auth = Buffer.from(`${user}:${pass}`).toString("base64");
    const res = await fetch(media.url, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!res.ok) {
      throw new Error(`TwilioChannel.fetchMedia: failed to download media (${res.status} ${res.statusText}): ${media.url}`);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") ?? media.contentType;
    return { bytes: buf, contentType };
  }
}

export function createTwilioChannel(): MessageChannel {
  return new TwilioChannel();
}
