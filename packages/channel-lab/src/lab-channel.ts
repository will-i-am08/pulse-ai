import { randomUUID } from "node:crypto";
import type {
  InboundMedia,
  InboundMessage,
  MessageChannel,
  OutboundMessage,
  SendResult,
} from "@pulse/shared";

/** Short-lived in-memory store for lab uploads (keyed by lab://media/<id>). */
export const labMediaStore = new Map<string, { bytes: Uint8Array; contentType: string }>();

export function storeLabMedia(bytes: Uint8Array, contentType: string): string {
  const id = randomUUID();
  const url = `lab://media/${id}`;
  labMediaStore.set(url, { bytes, contentType });
  return url;
}

export class LabChannel implements MessageChannel {
  readonly name = "lab";

  async send(_msg: OutboundMessage): Promise<SendResult> {
    // Outbound is logged by the gateway; nothing to deliver externally.
    return { providerMessageId: `lab_${randomUUID()}` };
  }

  async sendTyping(_to: string): Promise<void> {
    // No-op for now; the lab UI polls the thread for new replies.
  }

  parseInbound(payload: unknown): InboundMessage {
    const p = (payload ?? {}) as Record<string, unknown>;
    const media = Array.isArray(p.media) ? (p.media as InboundMedia[]) : [];
    return {
      from: String(p.from ?? ""),
      to: String(p.to ?? "lab"),
      body: String(p.body ?? ""),
      media,
      providerMessageId: String(p.providerMessageId ?? `lab_in_${randomUUID()}`),
      raw: payload,
    };
  }

  verifySignature(_url: string, _params: Record<string, string>, _signature: string): boolean {
    return true;
  }

  async fetchMedia(media: InboundMedia): Promise<{ bytes: Uint8Array; contentType: string }> {
    const stored = labMediaStore.get(media.url);
    if (!stored) {
      throw new Error(`LabChannel.fetchMedia: unknown lab media url ${media.url}`);
    }
    // One-shot: drop after fetch so memory doesn't grow across long sessions.
    labMediaStore.delete(media.url);
    return { bytes: stored.bytes, contentType: stored.contentType || media.contentType };
  }
}

export function createLabChannel(): MessageChannel {
  return new LabChannel();
}
