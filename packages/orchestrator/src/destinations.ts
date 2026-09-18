import { query, queryOne } from "@pulse/shared";
import type { Brand, Platform, Post, PublishDestination } from "@pulse/shared";
import {
  isMockOnlyPlatform,
  isPublishDestination,
  platformLabel,
} from "@pulse/shared";

/** Hard caps. X 280; Threads 500; LinkedIn 3000 (professional); TikTok 2200. */
export const CAPTION_LIMITS: Record<PublishDestination, number | null> = {
  instagram: null,
  facebook: null,
  x: 280,
  threads: 500,
  linkedin: 3000,
  tiktok: 2200,
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

/**
 * LinkedIn professional variant: soft-trim runaway emoji/hashtag spam, prefer
 * paragraph breaks over one IG hook line, then fit to 3000.
 */
export function fitLinkedInProfessional(text: string): string {
  let softened = text
    .trim()
    .replace(/([!?]){3,}/g, "$1$1")
    .replace(/([\p{Extended_Pictographic}\uFE0F]){6,}/gu, (m) => m.slice(0, 4))
    .replace(/(?:\s*#[\w]+){4,}/g, (m) => {
      const tags = m.match(/#[\w]+/g) ?? [];
      return tags.length ? ` ${tags.slice(0, 3).join(" ")}` : "";
    });
  // Promote single-block IG hooks into readable LI commentary when short.
  if (!/\n/.test(softened) && softened.length > 160) {
    const parts = softened.split(/(?<=[.!?])\s+/).filter(Boolean);
    if (parts.length >= 3) {
      softened = `${parts[0]} ${parts[1]}\n\n${parts.slice(2).join(" ")}`;
    }
  }
  return fitCaption(softened, 3000);
}

/** Prompt craft for LinkedIn-primary drafts (professional commentary, not Reel hooks). */
export function linkedInCaptionPromptBlock(): string {
  return [
    "Platform: LinkedIn (professional commentary, not Instagram/Reels).",
    "Caption: 2–4 short paragraphs (or 3–6 tight sentences). Lead with a concrete stake, insight, or observation — not a Reel hook, not 'wait for it', not emoji-led commands.",
    "Be specific (named craft, number on file, neighbourhood, product). Light CTA at most. ≤2 emoji total. ≤3 hashtags, optional, at the end.",
    "No scarcity/book-now energy unless the brief asks for a promo.",
  ].join("\n");
}

export function fitFor(platform: PublishDestination, text: string): string {
  if (platform === "linkedin") return fitLinkedInProfessional(text);
  const limit = CAPTION_LIMITS[platform];
  return limit == null ? text.trim() : fitCaption(text, limit);
}

/** Derive per-channel captions from one source line. */
export function buildPlatformCaptions(source: string): PlatformCaptions {
  const trimmed = source.trim();
  return {
    instagram: trimmed,
    facebook: trimmed,
    x: fitCaption(trimmed, 280),
    threads: fitCaption(trimmed, 500),
    linkedin: fitLinkedInProfessional(trimmed),
    tiktok: fitCaption(trimmed, 2200),
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
  const re =
    /\b(twitter|tweet|threads?|instagram|insta|\big\b|facebook|\bfb\b|\bx\b|linkedin|tiktok|tt)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[1]!.toLowerCase();
    let dest: PublishDestination;
    if (raw === "twitter" || raw === "tweet" || raw === "x") dest = "x";
    else if (raw === "thread" || raw === "threads") dest = "threads";
    else if (raw === "instagram" || raw === "insta" || raw === "ig") dest = "instagram";
    else if (raw === "facebook" || raw === "fb") dest = "facebook";
    else if (raw === "linkedin") dest = "linkedin";
    else if (raw === "tiktok" || raw === "tt") dest = "tiktok";
    else dest = "facebook";
    dests.push(dest);
  }
  return uniqueDests(dests);
}

/**
 * True destination picks ("X only", "LinkedIn and TikTok", …) — not questions,
 * edits, or competitor chat.
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
    .replace(
      /\b(twitter|tweet|threads?|instagram|insta|\big\b|facebook|\bfb\b|\bx\b|linkedin|tiktok|tt)\b/gi,
      " ",
    )
    .replace(
      /\b(only|just|and|both|&|to|on|post|put|publish|send|share|it|this|that|please|pls|the|my|our|feed|channel|channels|account|accounts|instead|page|company)\b/gi,
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
    linkedin: stored.linkedin ?? built.linkedin,
    tiktok: stored.tiktok ?? built.tiktok,
  };
}

export type PublishSlice = {
  platform: Platform;
  caption: string;
  mediaIds: string[];
};

/**
 * One slice per picked channel. Same media; each channel gets its caption variant.
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
      `Reply yes to post ${noun}. ${names} will land on the fake feed and will not go live.`,
    );
  } else {
    lines.push(`Reply yes to send it, or tell me a change.`);
  }
  return lines.join("\n").trim();
}

export const DEST_HINT =
  'Want this on X, Threads, LinkedIn, or TikTok? Reply "X only", "LinkedIn only", "TikTok only", or "LinkedIn and TikTok" — then "yes". A plain "yes" still posts to Instagram.';

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
 *
 * Multi-destination isolation (H6): each channel becomes its own post row, so
 * a LinkedIn failure cannot roll back a successful TikTok (or IG) sibling.
 *
 * The status update is a CLAIM: `and status = 'pending_approval'` means only one
 * caller can win it. Without that predicate a second "yes" (or a dashboard
 * approve racing an SMS approve — the inbound burst window is ~1.2s and this
 * path does ~8 sequential round-trips before writing) re-ran the whole thing and
 * inserted a fresh approved sibling per extra destination every time, so
 * duplicate posts went live on X/Threads/LinkedIn/TikTok. `claimed: false` means
 * someone else already approved it and this caller must do nothing.
 */
export async function approveSelectedDestinations(opts: {
  post: Post;
  brand: Brand;
  actor: string;
  postNow: boolean;
}): Promise<{ slices: PublishSlice[]; dests: Platform[]; claimed: boolean }> {
  const { post, brand, actor, postNow } = opts;
  const dests = selectedDestinations(post);
  const slices = slicesForApproval(post);
  const scheduledDue =
    post.scheduled_at != null &&
    Number.isFinite(new Date(post.scheduled_at).getTime()) &&
    new Date(post.scheduled_at).getTime() <= Date.now() + 60_000;
  // Past/due slots publish on the next tick — never keep yesterday's weekday on the row.
  const immediate = shouldPublishImmediately(dests, postNow) || scheduledDue;
  const captions = captionsForPost(post);
  const scheduledAt = immediate ? new Date().toISOString() : post.scheduled_at;

  const first = slices[0];
  if (!first) {
    throw new Error("approveSelectedDestinations: no destinations to publish");
  }

  const claimedRows = await query<{ id: string }>(
    `update posts
        set status = 'approved',
            platform = $1,
            caption = $2,
            destinations = $3::text[],
            captions = $4::jsonb,
            scheduled_at = $5
      where id = $6 and brand_id = $7 and status = 'pending_approval'
      returning id`,
    [first.platform, first.caption, dests, JSON.stringify(captions), scheduledAt, post.id, brand.id],
  );
  if (claimedRows.length === 0) {
    // Already approved by another turn — no log line, and above all no fan-out.
    return { slices, dests, claimed: false };
  }

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

  return { slices, dests, claimed: true };
}
