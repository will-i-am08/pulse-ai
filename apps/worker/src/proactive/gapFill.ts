import { query, queryOne, type Brand, type Pillar, type Post } from "@pulse/shared";
import {
  sendToBrand,
  isDaytime,
  chooseNextFormat,
  pickFreshPhoto,
  pickFreshPhotos,
  draftPostFromPhoto,
  draftCarouselFromPhotos,
  draftStoryFromPhoto,
  draftReelFromStills,
  videoEditFallbackSms,
  generateTipCarousel,
  generateTypedCarousel,
  composeClockSms,
} from "./deps.js";
import { logger } from "../lib/logger.js";

const GAP_PING_THROTTLE_MS = 24 * 60 * 60 * 1000;

/**
 * Proactive gap-fill: when a pillar is light for the week, draft a filler (or
 * nudge for a photo) via SMS. One touch per brand per 24h; overlap-guarded by
 * the worker tick flag.
 */
export async function runGapFillLoop(): Promise<void> {
  // Quiet hours. Every sibling proactive loop gates on this and sendToBrand has
  // no check of its own, so the caller's gate is the only thing between a 2am
  // Railway redeploy (runSoonMs: 20s) and a 2am text to every eligible client.
  if (!isDaytime(new Date())) return;

  const brands = await query<Brand>("select * from brands where status = 'active'");
  for (const brand of brands) {
    const paused = await queryOne(
      `select 1 from campaigns where brand_id = $1 and status = 'active' and pause_pillars = true
        and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at >= now()) limit 1`,
      [brand.id],
    );
    if (paused) continue;

    const pillars = await query<Pillar>(
      "select * from pillars where brand_id = $1 and posts_per_week > 0 order by last_gap_ping_at asc nulls first, sort, created_at",
      [brand.id],
    );
    if (
      pillars.some(
        (p) => p.last_gap_ping_at && Date.now() - new Date(p.last_gap_ping_at).getTime() < GAP_PING_THROTTLE_MS,
      )
    ) {
      continue;
    }

    for (const pillar of pillars) {
      const row = await queryOne<{ n: number }>(
        `select count(*)::int as n from posts
          where brand_id = $1 and pillar_id = $2
            and status in ('pending_approval','approved','scheduled')
            and scheduled_at between now() and now() + interval '7 days'`,
        [brand.id, pillar.id],
      );
      const have = Number(row?.n ?? 0);
      if (have >= pillar.posts_per_week) continue;

      const fmt = await chooseNextFormat(brand.id, pillar.id);
      let drafted: { post: Post; mediaUrl: string | null } | null = null;
      let kind = "post";
      let auto = false;
      try {
        if (fmt === "carousel") {
          const photos = await pickFreshPhotos(brand.id, 4);
          if (photos.length >= 2) {
            drafted = await draftCarouselFromPhotos(
              brand,
              photos.map((p) => p.id),
              pillar,
            );
            kind = "carousel from your photos";
          } else {
            const kinds = ["tip", "steps", "before_after", "menu_offer"] as const;
            const pick = kinds[Math.floor(Date.now() / 86_400_000) % kinds.length]!;
            const typed = await generateTypedCarousel(brand, pillar, pick);
            if (typed && typed.ok === false) {
              await sendToBrand(brand.id, typed.qaSms);
              await query("update pillars set last_gap_ping_at = now() where id = $1", [pillar.id]);
              break;
            }
            if (typed && typed.ok) {
              drafted = { post: typed.post, mediaUrl: typed.mediaUrl };
              kind = `${pick.replace("_", "/")} carousel`;
            } else {
              drafted = await generateTipCarousel(brand, pillar);
              kind = "tip carousel";
            }
          }
        } else if (fmt === "story") {
          const p = await pickFreshPhoto(brand.id);
          if (p) {
            const s = await draftStoryFromPhoto(brand, p, pillar);
            if (s) {
              drafted = { post: s.post, mediaUrl: s.mediaUrl };
              auto = s.auto;
              kind = "story";
            }
          }
        } else if (fmt === "reel") {
          // Motion template from stills → Reel; fall back to static feed if ffmpeg fails.
          const photos = await pickFreshPhotos(brand.id, 3);
          if (photos.length >= 1) {
            const reel = await draftReelFromStills(
              brand,
              photos.map((p) => p.id),
              pillar,
            );
            if (reel.ok) {
              drafted = { post: reel.post, mediaUrl: reel.coverUrl ?? reel.mediaUrl };
              kind = "Reel";
            } else {
              const p = photos[0]!;
              drafted = await draftPostFromPhoto(brand, p, pillar);
              kind = "post";
              if (drafted) {
                await sendToBrand(brand.id, videoEditFallbackSms(brand.name));
              }
            }
          }
        }
        if (!drafted) {
          const p = await pickFreshPhoto(brand.id);
          if (p) {
            drafted = await draftPostFromPhoto(brand, p, pillar);
            kind = "post";
          }
        }
      } catch (err) {
        logger.error(`gap-fill: format draft failed for brand ${brand.id}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      if (drafted) {
        auto = auto || drafted.post.is_auto;
        const when = drafted.post.scheduled_at
          ? new Date(drafted.post.scheduled_at).toLocaleString("en-AU", {
              weekday: "short",
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            })
          : "soon";
        const topic = pillar.name.toLowerCase();
        const lead = auto
          ? `We were a bit light on ${topic}, so I put together a ${kind} and scheduled it for ${when}. Reply HOLD to stop it, or tell me a change.`
          : await composeClockSms(
              brand,
              `Gap-fill: pillar "${pillar.name}" was light so you drafted a ${kind} (status pending_approval, proposed ${when}). Caption:\n${drafted.post.caption}\nTell them you drafted it. Still wait for yes unless this is autopilot. Do not dump yes/change/no. Do not publish.`,
            );
        await sendToBrand(brand.id, lead, drafted.mediaUrl ? [drafted.mediaUrl] : undefined);
        await query("update pillars set last_gap_ping_at = now() where id = $1", [pillar.id]);
        break;
      }

      const nudge = await composeClockSms(
        brand,
        `Gap-fill: pillar "${pillar.name}" is light this week and you have no photo to draft from. Nudge once like a colleague for a snap, or offer to put something together. No yes/change/no menu. Do not publish.`,
      );
      await sendToBrand(brand.id, nudge);
      await query("update pillars set last_gap_ping_at = now() where id = $1", [pillar.id]);
      break;
    }
  }
}
