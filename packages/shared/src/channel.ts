// The swappable messaging-provider seam. Twilio is the first adapter;
// WhatsApp becomes a second adapter later without touching the orchestrator.

export interface InboundMedia {
  /** Provider URL — short-lived; must be downloaded immediately, never persisted as-is. */
  url: string;
  contentType: string;
}

export interface InboundMessage {
  from: string;          // E.164 sender — matched to a Brand.client_phone
  to: string;            // the provider number that received it
  body: string;
  media: InboundMedia[];
  providerMessageId: string;
  raw: unknown;          // original payload, for audit
}

export interface OutboundMessage {
  to: string;            // E.164 recipient
  body: string;
  mediaUrls?: string[];  // publicly reachable URLs for MMS
}

export interface SendResult {
  providerMessageId: string;
}

export interface MessageChannel {
  /** Stable identifier, e.g. "twilio-sms". */
  readonly name: string;

  /** Send an outbound message (reply or proactive). Retries/backoff are the caller's concern. */
  send(msg: OutboundMessage): Promise<SendResult>;

  /**
   * Show a "typing..." indicator to the recipient (best-effort, never throws).
   * Channels without a native indicator (e.g. plain SMS) should no-op.
   * @param to  the channel-native recipient address (same as OutboundMessage.to)
   */
  sendTyping?(to: string): Promise<void>;

  /** Parse a raw provider webhook payload into a normalised InboundMessage. */
  parseInbound(payload: unknown): InboundMessage;

  /**
   * Verify the webhook is genuinely from the provider.
   * @param url  the full public URL the provider POSTed to
   * @param params  the raw request params/body used to compute the signature
   * @param signature  the provider-supplied signature header
   */
  verifySignature(url: string, params: Record<string, string>, signature: string): boolean;

  /**
   * Fetch inbound media bytes from the provider (may require provider auth),
   * so callers never depend on the short-lived URL after receipt.
   */
  fetchMedia(media: InboundMedia): Promise<{ bytes: Uint8Array; contentType: string }>;

  /**
   * Optional recovery: when the webhook body omitted media (NumMedia=0 / truncated
   * form), list media for this provider message id via the provider REST API.
   */
  listMessageMedia?(providerMessageId: string): Promise<InboundMedia[]>;
}
