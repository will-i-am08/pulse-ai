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

function requireCreds(): { accountSid: string; authToken: string } {
  const env = getServerEnv();
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    throw new Error("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set to use TwilioChannel");
  }
  return { accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN };
}

export class TwilioChannel implements MessageChannel {
  readonly name = "twilio-sms";

  private clientCache: ReturnType<typeof twilio> | null = null;

  private client(): ReturnType<typeof twilio> {
    if (this.clientCache) return this.clientCache;
    const { accountSid, authToken } = requireCreds();
    this.clientCache = twilio(accountSid, authToken);
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
    const env = getServerEnv();
    if (!env.TWILIO_AUTH_TOKEN) return false;
    return twilio.validateRequest(env.TWILIO_AUTH_TOKEN, signature, url, params);
  }

  async fetchMedia(media: InboundMedia): Promise<{ bytes: Uint8Array; contentType: string }> {
    const { accountSid, authToken } = requireCreds();
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
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
