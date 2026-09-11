import { query, queryOne } from "@pulse/shared";
import type { Brand, Platform, Post, PublishDestination } from "@pulse/shared";
import {
  isMockOnlyPlatform,
  isPublishDestination,
  platformLabel,
} from "@pulse/shared";

/** Hard caps. X is 280; Threads is 500. Instagram/Facebook keep the drafted line. */
export const CAPTION_LIMITS: Record<PublishDestination, number | null> = {
  instagram: null,
  facebook: null,
  x: 280,
  threads: 500,
};

export type PlatformCaptions = Partial<Record<PublishDestination, string>>;

const EDIT_HINTS = [
  "change",
  "make it",
  "shorter",
  "longer",
  "instead",
  "reword",
  "edit",
  "fix",
  "replace",
  "remove",
  "different caption",
  "try again",
  "redo",
  "less emoji",
  "no emoji",
  "swap",
  "reduce",
  "rewrite",
  "tweak",
  "not quite",
];

/**
 * Truncate to `max` characters on a word boundary when possible. Never exceeds
 * the cap — this is the guarantee, not a prompt hint.
 */
export function fitCaption(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  if (max <= 0) return "";
  const slice = trimmed.slice(0, max);
  const sp = slice.lastIndexOf(" ");
  const cut = sp >= Math.floor(max * 0.6) ? slice.slice(0, sp) : slice;
  return cut.trimEnd().slice(0, max);
}

export function fitFor(platform: PublishDestination, text: string): string {
  const limit = CAPTION_LIMITS[platform];
  return limit == null ? text.trim() : fitCaption(text, limit);
}

/** Derive per-channel captions from one source line. Threads keeps more than X when the source is longer. */
export function buildPlatformCaptions(source: string): PlatformCaptions {
  const trimmed = source.trim();
  return {
    instagram: trimmed,
    facebook: trimmed,
    x: fitCaption(trimmed, 280),
    threads: fitCaption(trimmed, 500),
  };
}

export function captionFor(
  captions: PlatformCaptions,
  platform: PublishDestination,
  fallback = "",
): string {
  return captions[platform] ?? fitFor(platform, fallback);
}

function uniqueDests(list: PublishDestination[]): PublishDestination[] {
  const seen = new Set<PublishDestination>();
  const out: PublishDestination[] = [];
  for (const d of list) {
    if (seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  return out;
}

/** Pull platform aliases out of free text, preserving mention order. */
export function extractPlatforms(text: string): PublishDestination[] {
  const dests: PublishDestination[] = [];
  const re = /\b(twitter|tweet|threads?|instagram|insta|\big\b|facebook|\bfb\b|\bx\b)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[1]!.toLowerCase();
    let dest: PublishDestination;
    if (raw === "twitter" || raw === "tweet" || raw === "x") dest = "x";
    else if (raw === "thread" || raw === "threads") dest = "threads";
    else if (raw === "instagram" || raw === "insta" || raw === "ig") dest = "instagram";
    else dest = "facebook";
    dests.push(dest);
  }
  return uniqueDests(dests);
}

/**
 * True destination picks ("X only", "Threads only", "X and Threads",
 * "post this to Instagram") — not questions, edits, or competitor chat.
 */
export function parseDestinationChoice(body: string | null | undefined): PublishDestination[] | null {
  const text = (body ?? "").trim();
  if (!text || text.length > 120) return null;
  if (/[?]/.test(text)) return null;
  const lower = text.toLowerCase();
  if (EDIT_HINTS.some((s) => lower.includes(s))) return null;
  if (/\b(what|who|why|how|when|where|competitor|ad library)\b/i.test(text)) return null;

  const dests = extractPlatforms(text);
  if (dests.length === 0) return null;

  const leftover = text
    .replace(/\b(twitter|tweet|threads?|instagram|insta|\big\b|facebook|\bfb\b|\bx\b)\b/gi, " ")
    .replace(
      /\b(only|just|and|both|&|to|on|post|put|publish|send|share|it|this|that|please|pls|the|my|our|feed|channel|channels|account|accounts|instead)\b/gi,
      " ",
    )
    .replace(/[.!,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (leftover.length > 0) return null;
  return dests;
}

export function selectedDestinations(post: Pick<Post, "platform" | "destinations">): Platform[] {
  const fromCol = uniqueDests((post.destinations ?? []).filter(isPublishDestination));
  if (fromCol.length) return fromCol;
  if (post.platform) return [post.platform];
  return ["instagram"];
}

export function captionsForPost(post: Pick<Post, "caption" | "captions">): PlatformCaptions {
  const stored = (post.captions ?? {}) as PlatformCaptions;
  const source = post.caption ?? "";
  const built = buildPlatformCaptions(source);
  return {
    instagram: stored.instagram ?? built.instagram,
    facebook: stored.facebook ?? built.facebook,
    x: stored.x ?? built.x,
    threads: stored.threads ?? built.threads,
  };
}

export type PublishSlice = {
  platform: Platform;
  caption: string;
  mediaIds: string[];
};

/**
 * One slice per picked channel. Same photo; X gets the short line, Threads the
 * longer one (or the same line when the source already fit in 280).
 */
export function slicesForApproval(post: Post): PublishSlice[] {
  const dests = selectedDestinations(post);
  const captions = captionsForPost(post);
  const mediaIds = [...(post.media_ids ?? [])];
  return dests.map((platform) => ({
    platform,
    caption: isPublishDestination(platform)
      ? captionFor(captions, platform, post.caption ?? "")
      : (post.caption ?? ""),
    mediaIds,
  }));
}

export function shouldPublishImmediately(dests: Platform[], postNow: boolean): boolean {
  if (postNow) return true;
  return dests.length > 0 && dests.every(isMockOnlyPlatform);
}

export function destinationAck(
  dests: PublishDestination[],
  captions: PlatformCaptions,
  sourceCaption: string,
  prefix = "Got it",
): string {
  const names = dests.map(platformLabel).join(" and ");
  const only = dests.length === 1 ? " only" : "";
  const lines: string[] = [`${prefix} — ${names}${only}.`, ""];
  for (const d of dests) {
    const cap = captionFor(captions, d, sourceCaption);
    const limit = CAPTION_LIMITS[d];
    const count = limit != null ? ` (${cap.length}/${limit})` : "";
    if (dests.length === 1) {
      lines.push(`"${cap}"${count}`);
    } else {
      lines.push(`${platformLabel(d)}:${count}`);
      lines.push(`"${cap}"`);
    }
    lines.push("");
  }
  const mockish = dests.some(isMockOnlyPlatform);
  const noun = dests.length === 1 ? "it" : "them";
  if (mockish) {
    lines.push(
      `Reply "yes" to post ${noun}. ${names} will land on the fake feed and will not go live.`,
    );
  } else {
    lines.push(`Reply "yes" to approve, or tell me a change.`);
  }
  return lines.join("\n").trim();
}

export const DEST_HINT =
  'Want this on X or Threads? Reply "X only", "Threads only", or "X and Threads" — then "yes". A plain "yes" still posts to Instagram.';

export function approvalReply(dests: Platform[], when: string): string {
  const names = dests.map(platformLabel).join(" and ");
  const mockish = dests.some(isMockOnlyPlatform);
  if (mockish) {
    return `Approved${when}. ${names} will land on the fake feed and will not go live.`;
  }
  return `Approved${when}.`;
}

export async function persistDestinations(
  post: Post,
  dests: PublishDestination[],
  sourceCaption: string,
): Promise<PlatformCaptions> {
  const captions = buildPlatformCaptions(sourceCaption);
  await query(
    `update posts
        set destinations = $1::text[],
            captions = $2::jsonb,
            platform = $3
      where id = $4 and brand_id = $5`,
    [dests, JSON.stringify(captions), dests[0], post.id, post.brand_id],
  );
  return captions;
}

export async function persistEditedCaptions(
  post: Post,
  sourceCaption: string,
): Promise<PlatformCaptions> {
  const captions = buildPlatformCaptions(sourceCaption);
  await query(
    `update posts
        set caption = $1,
            captions = $2::jsonb
      where id = $3 and brand_id = $4`,
    [sourceCaption, JSON.stringify(captions), post.id, post.brand_id],
  );
  return captions;
}

/**
 * Mark the draft approved and clone it once per extra picked channel.
 * Never sets publishing/published — the worker publish loop does that.
 * Never asks for an API key.
 */
export async function approveSelectedDestinations(opts: {
  post: Post;
  brand: Brand;
  actor: string;
  postNow: boolean;
}): Promise<{ slices: PublishSlice[]; dests: Platform[] }> {
  const { post, brand, actor, postNow } = opts;
  const dests = selectedDestinations(post);
  const slices = slicesForApproval(post);
  const immediate = shouldPublishImmediately(dests, postNow);
  const captions = captionsForPost(post);
  const scheduledAt = immediate ? new Date().toISOString() : post.scheduled_at;

  const first = slices[0];
  if (!first) {
    throw new Error("approveSelectedDestinations: no destinations to publish");
  }

  await query(
    `update posts
        set status = 'approved',
            platform = $1,
            caption = $2,
            destinations = $3::text[],
            captions = $4::jsonb,
            scheduled_at = $5
      where id = $6 and brand_id = $7`,
    [first.platform, first.caption, dests, JSON.stringify(captions), scheduledAt, post.id, brand.id],
  );

  await query(
    `insert into approval_log (post_id, brand_id, action, actor, note)
     values ($1, $2, 'approved', $3, $4)`,
    [post.id, brand.id, actor, `Approved via inbound message (${dests.join(", ")})`],
  );

  for (const slice of slices.slice(1)) {
    const sibling = await queryOne<Post>(
      `insert into posts (
          brand_id, caption, media_ids, source_media_ids, style_meta, pillar_id,
          is_auto, format, platform, status, scheduled_at, destinations, captions, campaign_id
        )
        values (
          $1, $2, $3::uuid[], $4::uuid[], $5::jsonb, $6,
          false, $7, $8, 'approved', $9,
          $10::text[], $11::jsonb, $12
        )
        returning *`,
      [
        brand.id,
        slice.caption,
        slice.mediaIds,
        post.source_media_ids ?? post.media_ids,
        JSON.stringify(post.style_meta ?? {}),
        post.pillar_id,
        post.format,
        slice.platform,
        scheduledAt,
        [slice.platform],
        JSON.stringify(captions),
        post.campaign_id ?? null,
      ],
    );
    if (sibling) {
      await query(
        `insert into approval_log (post_id, brand_id, action, actor, note)
         values ($1, $2, 'approved', $3, $4)`,
        [sibling.id, brand.id, actor, `Approved via inbound message (fan-out ${slice.platform})`],
      );
    }
  }

  return { slices, dests };
}
