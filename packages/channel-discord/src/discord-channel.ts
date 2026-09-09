import type { Client } from "discord.js";
import type {
  InboundMedia,
  InboundMessage,
  MessageChannel,
  OutboundMessage,
  SendResult,
} from "@pulse/shared";

/**
 * Discord adapter for the MessageChannel interface. Outbound send + media
 * download only — inbound arrives as gateway events, which the bot maps to an
 * InboundMessage directly (so parseInbound/verifySignature are unused here).
 */
export class DiscordChannel implements MessageChannel {
  readonly name = "discord";

  constructor(private readonly client: Client) {}

  async send(msg: OutboundMessage): Promise<SendResult> {
    const channel = await this.client.channels.fetch(msg.to);
    if (!channel || !channel.isTextBased() || !("send" in channel)) {
      throw new Error(`DiscordChannel.send: channel ${msg.to} is not a sendable text channel`);
    }
    const sent = await (channel as { send: (o: unknown) => Promise<{ id: string }> }).send({
      content: msg.body,
      ...(msg.mediaUrls && msg.mediaUrls.length > 0 ? { files: msg.mediaUrls } : {}),
    });
    return { providerMessageId: sent.id };
  }

  /**
   * Discord typing indicator ("... is typing"). Expires after ~10s server-side,
   * so callers should re-call on an interval while work is ongoing.
   * Best-effort: never throws — logs and no-ops on missing perms/channels.
   */
  async sendTyping(to: string): Promise<void> {
    try {
      const channel = await this.client.channels.fetch(to);
      if (!channel || !channel.isTextBased() || !("sendTyping" in channel)) return;
      await (channel as { sendTyping: () => Promise<unknown> }).sendTyping();
    } catch (err) {
      console.warn(`DiscordChannel.sendTyping: skipping for ${to}`, err);
    }
  }

  parseInbound(): InboundMessage {
    throw new Error("DiscordChannel.parseInbound is not used — the bot maps events to InboundMessage");
  }

  verifySignature(): boolean {
    return true;
  }

  async fetchMedia(media: InboundMedia): Promise<{ bytes: Uint8Array; contentType: string }> {
    const res = await fetch(media.url);
    if (!res.ok) {
      throw new Error(`DiscordChannel.fetchMedia: failed (${res.status} ${res.statusText}) for ${media.url}`);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") ?? media.contentType;
    return { bytes, contentType };
  }
}

export function createDiscordChannel(client: Client): DiscordChannel {
  return new DiscordChannel(client);
}
