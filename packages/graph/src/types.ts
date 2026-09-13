import type { Brand, Interaction, Platform, PostFormat } from "@pulse/shared";

/**
 * Frozen interface — see docs/BUILD_CONTRACTS.md § C · @pulse/graph.
 * `format` is an additive, optional field (defaults to 'feed'); existing callers
 * are unaffected.
 */
export interface GraphAdapter {
  publish(input: {
    brand: Brand;
    platform: Platform;
    caption: string;
    mediaUrls: string[];
    format?: PostFormat;
    /** Post style_meta — used for TikTok AIGC disclosure when aigc/ai_video_job_id set. */
    styleMeta?: Record<string, unknown> | null;
  }): Promise<{ externalPostId: string; permalink: string | null }>;

  fetchEngagement(
    brand: Brand,
    externalPostId: string,
    platform: Platform
  ): Promise<Record<string, number>>;

  last24hCount(brand: Brand, platform: Platform): Promise<number>;

  /**
   * Additive engagement methods (Phase A). Optional so existing adapters keep
   * compiling; the worker engagement loop checks for their presence.
   * `reply` posts an auto-approved reply to a comment/mention/DM/review and
   * returns the platform's reply id. `hide` removes obvious spam from public
   * view. Both are best-effort at the Graph level — triage state in Postgres
   * is already final when these run, so failures must surface (throw), never
   * silently pass.
   */
  reply?(input: {
    brand: Brand;
    interaction: Interaction;
    body: string;
  }): Promise<{ externalReplyId: string | null }>;

  /**
   * Private reply to a commenter (IG/FB): opens a DM thread from a comment id.
   * Used to fulfill "comment LINK and I'll DM you" destination-link offers.
   * One private reply per comment (Meta limit); caller must enforce idempotency.
   */
  privateReply?(input: {
    brand: Brand;
    interaction: Interaction;
    body: string;
  }): Promise<{ externalReplyId: string | null }>;

  hide?(input: {
    brand: Brand;
    interaction: Interaction;
  }): Promise<void>;
}
