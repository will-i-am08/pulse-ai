import { randomUUID } from "node:crypto";
import type {
  InboundMedia,
  InboundMessage,
  MessageChannel,
  OutboundMessage,
  SendResult,
} from "@pulse/shared";

type Stored = { bytes: Uint8Array; contentType: string };

/**
 * Process-wide store so Next.js duplicate module copies still see lab uploads.
 * Instance maps are the primary lookup; this is the fallback.
 */
function globalLabMediaStore(): Map<string, Stored> {
  const g = globalThis as typeof globalThis & { __pulseLabMediaStore?: Map<string, Stored> };
  if (!g.__pulseLabMediaStore) g.__pulseLabMediaStore = new Map();
  return g.__pulseLabMediaStore;
}

/** Short-lived in-memory store for lab uploads (keyed by lab://media/<id>). */
export const labMediaStore = globalLabMediaStore();

export function storeLabMedia(bytes: Uint8Array, contentType: string): string {
  const id = randomUUID();
  const url = `lab://media/${id}`;
  globalLabMediaStore().set(url, { bytes, contentType });
  return url;
}

export class LabChannel implements MessageChannel {
  readonly name = "lab";
  private readonly media = new Map<string, Stored>();

  /** Keep bytes on THIS channel instance so fetchMedia never misses a bundled copy. */
  storeMedia(bytes: Uint8Array, contentType: string): string {
    const url = storeLabMedia(bytes, contentType);
    this.media.set(url, { bytes, contentType });
    return url;
  }

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
    const stored = this.media.get(media.url) ?? globalLabMediaStore().get(media.url);
    if (!stored) {
      throw new Error(`LabChannel.fetchMedia: unknown lab media url ${media.url}`);
    }
    this.media.delete(media.url);
    globalLabMediaStore().delete(media.url);
    return { bytes: stored.bytes, contentType: stored.contentType || media.contentType };
  }
}

export function createLabChannel(): LabChannel {
  return new LabChannel();
}
