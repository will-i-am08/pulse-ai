import { spawn, execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import sharp from "sharp";
import {
  query,
  queryOne,
  getMedia,
  putMedia,
  publicMediaUrl,
  type Brand,
  type MediaAsset,
  type Pillar,
  type Post,
} from "@pulse/shared";
import { draftCaption } from "./draftCaption.js";
import { scheduleSlot } from "./scheduler.js";
import { ensurePillars, classifyPhotoPillar } from "./pillars.js";
import { overlayMasthead } from "./faceless.js";

const execFileAsync = promisify(execFile);

/** IG Reels soft limits we enforce before upload (clear SMS on fail). */
export const REEL_MAX_BYTES = 100 * 1024 * 1024; // 100 MB
export const REEL_MAX_DURATION_SEC = 90;
export const REEL_MIN_DURATION_SEC = 1;
export const REEL_SUPPORTED_CODECS = new Set(["h264", "hevc", "h265", "aac", "mp3", "pcm_s16le"]);

export type FfmpegAvailability = {
  ffmpeg: boolean;
  ffprobe: boolean;
  path: string | null;
};

let cachedFfmpeg: FfmpegAvailability | null = null;

/** Detect ffmpeg/ffprobe once per process. Clear fallbacks when missing. */
export async function detectFfmpeg(): Promise<FfmpegAvailability> {
  if (cachedFfmpeg) return cachedFfmpeg;
  const check = async (bin: string): Promise<boolean> => {
    try {
      await execFileAsync(bin, ["-version"], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  };
  const ffmpeg = await check("ffmpeg");
  const ffprobe = await check("ffprobe");
  cachedFfmpeg = { ffmpeg, ffprobe, path: ffmpeg ? "ffmpeg" : null };
  return cachedFfmpeg;
}

/** Test helper — reset detection cache. */
export function resetFfmpegCache(): void {
  cachedFfmpeg = null;
}

export type VideoProbe = {
  durationSec: number;
  width: number;
  height: number;
  videoCodec: string | null;
  audioCodec: string | null;
  sizeBytes: number;
};

export type VideoValidation =
  | { ok: true; probe: VideoProbe }
  | { ok: false; sms: string; probe?: VideoProbe };

async function writeTemp(bytes: Uint8Array, ext: string): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), "kip-video-"));
  const path = join(dir, `in.${ext}`);
  await fs.writeFile(path, Buffer.from(bytes));
  return path;
}

async function cleanupTemp(path: string): Promise<void> {
  try {
    const dir = join(path, "..");
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function extForContentType(ct: string | null | undefined): string {
  if (!ct) return "mp4";
  if (/quicktime|mov/i.test(ct)) return "mov";
  if (/webm/i.test(ct)) return "webm";
  if (/3gpp/i.test(ct)) return "3gp";
  return "mp4";
}

/** Probe video metadata via ffprobe when available. */
export async function probeVideo(bytes: Uint8Array, contentType?: string | null): Promise<VideoProbe | null> {
  const avail = await detectFfmpeg();
  if (!avail.ffprobe) return null;
  const path = await writeTemp(bytes, extForContentType(contentType));
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        path,
      ],
      { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout) as {
      format?: { duration?: string; size?: string };
      streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }>;
    };
    const v = parsed.streams?.find((s) => s.codec_type === "video");
    const a = parsed.streams?.find((s) => s.codec_type === "audio");
    return {
      durationSec: Number(parsed.format?.duration ?? 0) || 0,
      width: v?.width ?? 0,
      height: v?.height ?? 0,
      videoCodec: v?.codec_name ?? null,
      audioCodec: a?.codec_name ?? null,
      sizeBytes: Number(parsed.format?.size ?? bytes.byteLength) || bytes.byteLength,
    };
  } catch (err) {
    console.error("probeVideo failed", err);
    return null;
  } finally {
    await cleanupTemp(path);
  }
}

/** Validate client video against IG Reel constraints. Returns clear SMS on fail. */
export async function validateReelVideo(
  bytes: Uint8Array,
  contentType?: string | null,
): Promise<VideoValidation> {
  if (bytes.byteLength > REEL_MAX_BYTES) {
    return {
      ok: false,
      sms: `That video's too large (${Math.round(bytes.byteLength / (1024 * 1024))}MB). Instagram Reels need under ~100MB — trim it or send a shorter clip?`,
    };
  }
  if (bytes.byteLength < 1024) {
    return { ok: false, sms: "That video file looks empty or corrupted. Mind sending it again?" };
  }

  const probe = await probeVideo(bytes, contentType);
  if (!probe) {
    // No ffprobe — accept common containers; Meta will reject later if needed.
    const ct = (contentType ?? "").toLowerCase();
    if (ct && !/video\/(mp4|quicktime|x-m4v|webm|3gpp)/.test(ct) && !ct.startsWith("video/")) {
      return {
        ok: false,
        sms: "I couldn't play that video format. Send an MP4 or MOV (H.264) and I'll turn it into a Reel.",
      };
    }
    return {
      ok: true,
      probe: {
        durationSec: 0,
        width: 0,
        height: 0,
        videoCodec: null,
        audioCodec: null,
        sizeBytes: bytes.byteLength,
      },
    };
  }

  if (probe.durationSec > REEL_MAX_DURATION_SEC) {
    return {
      ok: false,
      sms: `That clip is ${Math.round(probe.durationSec)}s — Reels work best under ${REEL_MAX_DURATION_SEC}s. Trim it and resend?`,
      probe,
    };
  }
  if (probe.durationSec > 0 && probe.durationSec < REEL_MIN_DURATION_SEC) {
    return {
      ok: false,
      sms: "That clip's too short to post as a Reel. Send something at least a second long?",
      probe,
    };
  }
  if (probe.videoCodec && !REEL_SUPPORTED_CODECS.has(probe.videoCodec.toLowerCase())) {
    return {
      ok: false,
      sms: `I can't use that video codec (${probe.videoCodec}). Export as H.264 MP4/MOV and I'll draft a Reel.`,
      probe,
    };
  }
  return { ok: true, probe };
}

/**
 * Sample up to `count` JPEG frames from a video for vision captioning.
 * Returns empty array when ffmpeg is missing (caller falls back).
 */
export async function extractVideoFrames(
  bytes: Uint8Array,
  opts?: { count?: number; contentType?: string | null },
): Promise<Buffer[]> {
  const count = Math.max(1, Math.min(opts?.count ?? 4, 6));
  const avail = await detectFfmpeg();
  if (!avail.ffmpeg) {
    // Stub path: try sharp on first bytes (won't work for most codecs) — documented fallback.
    try {
      const frame = await sharp(Buffer.from(bytes), { failOn: "none" })
        .rotate()
        .resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      return [frame];
    } catch {
      return [];
    }
  }

  const inPath = await writeTemp(bytes, extForContentType(opts?.contentType));
  const outDir = join(inPath, "..");
  try {
    const probe = await probeVideo(bytes, opts?.contentType);
    const duration = Math.max(probe?.durationSec ?? 3, 1);
    const frames: Buffer[] = [];
    for (let i = 0; i < count; i++) {
      // Spread samples across the clip (skip very start/end).
      const t = duration * ((i + 0.5) / count);
      const outPath = join(outDir, `frame_${i}.jpg`);
      try {
        await execFileAsync(
          "ffmpeg",
          ["-y", "-ss", String(t.toFixed(2)), "-i", inPath, "-frames:v", "1", "-q:v", "3", outPath],
          { timeout: 60_000 },
        );
        const jpg = await fs.readFile(outPath);
        const scaled = await sharp(jpg)
          .resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 82 })
          .toBuffer();
        frames.push(scaled);
      } catch (err) {
        console.error(`extractVideoFrames: frame ${i} failed`, err);
      }
    }
    return frames;
  } finally {
    await cleanupTemp(inPath);
  }
}

/** Store a video buffer as a new media_asset. */
export async function storeVideoAsset(
  brandId: string,
  bytes: Uint8Array,
  contentType = "video/mp4",
  source: "client" | "operator" = "operator",
): Promise<string> {
  const id = randomUUID();
  await query(
    `insert into media_assets (id, brand_id, storage_path, kind, source, content_type)
     values ($1, $2, $3, 'video', $4, $5)`,
    [id, brandId, id, source, contentType],
  );
  await putMedia(id, bytes, contentType);
  return id;
}

/** Store a JPEG still (e.g. cover frame) as a photo asset. */
export async function storePhotoAsset(
  brandId: string,
  bytes: Uint8Array,
  source: "client" | "operator" = "operator",
): Promise<string> {
  const id = randomUUID();
  await query(
    `insert into media_assets (id, brand_id, storage_path, kind, source, content_type)
     values ($1, $2, $3, 'photo', $4, 'image/jpeg')`,
    [id, brandId, id, source],
  );
  await putMedia(id, new Uint8Array(bytes), "image/jpeg");
  return id;
}

// ─── G3 light edits ─────────────────────────────────────────────────────────

export type LightEditOpts = {
  /** Trim start (seconds). */
  trimStartSec?: number;
  /** Trim end (seconds); if unset, keep to end. */
  trimEndSec?: number;
  /** Burn short text overlay onto the video (bottom-safe zone). */
  textOverlay?: string;
  /** Extract cover frame at this timestamp (default mid-clip). */
  coverAtSec?: number;
};

/**
 * Light edit: trim / text overlay when ffmpeg is available.
 * Returns null when ffmpeg missing or edit fails (caller SMS-falls-back).
 */
export async function lightEditVideo(
  bytes: Uint8Array,
  opts: LightEditOpts,
  contentType?: string | null,
): Promise<{ video: Buffer; coverJpeg: Buffer | null } | null> {
  const avail = await detectFfmpeg();
  if (!avail.ffmpeg) return null;

  const inPath = await writeTemp(bytes, extForContentType(contentType));
  const outDir = join(inPath, "..");
  const outPath = join(outDir, "out.mp4");
  try {
    const args = ["-y", "-i", inPath];
    if (opts.trimStartSec != null && opts.trimStartSec > 0) {
      args.push("-ss", String(opts.trimStartSec));
    }
    if (opts.trimEndSec != null && opts.trimEndSec > 0) {
      args.push("-to", String(opts.trimEndSec));
    }

    const filters: string[] = [];
    if (opts.textOverlay?.trim()) {
      const escaped = opts.textOverlay
        .trim()
        .slice(0, 48)
        .replace(/\\/g, "\\\\")
        .replace(/:/g, "\\:")
        .replace(/'/g, "\\'");
      filters.push(
        `drawtext=text='${escaped}':fontsize=48:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h-th-80`,
      );
    }
    if (filters.length) args.push("-vf", filters.join(","));
    args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-movflags", "+faststart", outPath);

    await execFileAsync("ffmpeg", args, { timeout: 120_000 });
    const video = await fs.readFile(outPath);

    let coverJpeg: Buffer | null = null;
    const coverAt = opts.coverAtSec ?? Math.max((opts.trimStartSec ?? 0) + 0.5, 0.5);
    const coverPath = join(outDir, "cover.jpg");
    try {
      await execFileAsync(
        "ffmpeg",
        ["-y", "-ss", String(coverAt), "-i", outPath, "-frames:v", "1", "-q:v", "3", coverPath],
        { timeout: 30_000 },
      );
      coverJpeg = await fs.readFile(coverPath);
    } catch {
      coverJpeg = null;
    }
    return { video, coverJpeg };
  } catch (err) {
    console.error("lightEditVideo failed", err);
    return null;
  } finally {
    await cleanupTemp(inPath);
  }
}

/**
 * Motion template from stills: Ken Burns zoom/pan or slideshow → MP4.
 * When ffmpeg is missing, returns null (documented stub — caller falls back to static).
 */
export async function motionFromStills(
  stills: Buffer[],
  opts?: { secondsPerStill?: number; mode?: "kenburns" | "slideshow" },
): Promise<Buffer | null> {
  if (stills.length === 0) return null;
  const avail = await detectFfmpeg();
  if (!avail.ffmpeg) {
    console.warn("motionFromStills: ffmpeg unavailable — stub returns null (fall back to static)");
    return null;
  }

  const sec = Math.max(1.5, Math.min(opts?.secondsPerStill ?? 2.5, 5));
  const mode = opts?.mode ?? (stills.length === 1 ? "kenburns" : "slideshow");
  const dir = await fs.mkdtemp(join(tmpdir(), "kip-motion-"));
  try {
    const paths: string[] = [];
    for (let i = 0; i < stills.length; i++) {
      const framed = await sharp(stills[i]!)
        .rotate()
        .resize({ width: 1080, height: 1920, fit: "cover", position: "centre" })
        .jpeg({ quality: 90 })
        .toBuffer();
      const p = join(dir, `still_${i}.jpg`);
      await fs.writeFile(p, framed);
      paths.push(p);
    }

    const outPath = join(dir, "motion.mp4");
    if (mode === "kenburns" || paths.length === 1) {
      // Single (or first) still with slow zoom — simple Ken Burns.
      const p = paths[0]!;
      await execFileAsync(
        "ffmpeg",
        [
          "-y",
          "-loop",
          "1",
          "-i",
          p,
          "-vf",
          `scale=1200:2133,zoompan=z='min(zoom+0.0015,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.round(sec * 25 * Math.max(paths.length, 3))}:s=1080x1920:fps=25`,
          "-t",
          String(sec * Math.max(paths.length, 3)),
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          outPath,
        ],
        { timeout: 180_000 },
      );
    } else {
      // Slideshow concat of stills (each held for `sec`).
      const listPath = join(dir, "list.txt");
      const lines = paths.flatMap((p) => [`file '${p}'`, `duration ${sec}`]);
      // Last file must be repeated without duration for concat demuxer.
      lines.push(`file '${paths[paths.length - 1]}'`);
      await fs.writeFile(listPath, lines.join("\n"));
      await execFileAsync(
        "ffmpeg",
        [
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          listPath,
          "-vf",
          "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=25",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          outPath,
        ],
        { timeout: 180_000 },
      );
    }
    return await fs.readFile(outPath);
  } catch (err) {
    console.error("motionFromStills failed", err);
    return null;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** SMS when motion/light-edit fails — fall back to static post. */
export function videoEditFallbackSms(brandName: string): string {
  return `Couldn't animate that into a Reel just now for ${brandName} — I've drafted a static post instead. Reply yes to send it, or send a video clip.`;
}

/**
 * Draft a Reel from a client-sent video: validate → caption with visual
 * understanding → pending_approval labeled as Reel.
 */
export async function draftReelFromVideo(
  brand: Brand,
  video: MediaAsset,
  opts?: { body?: string; pillar?: Pillar | null },
): Promise<
  | { ok: true; post: Post; mediaUrl: string | null; coverUrl: string | null }
  | { ok: false; sms: string }
> {
  const blob = await getMedia(video.id);
  if (!blob) {
    return { ok: false, sms: "I couldn't load that video. Mind sending it again?" };
  }

  const validation = await validateReelVideo(blob.bytes, video.content_type ?? blob.contentType);
  if (!validation.ok) return { ok: false, sms: validation.sms };

  // Optional light trim when the owner asked ("trim the start", etc.).
  let mediaId = video.id;
  let coverId: string | null = null;
  const body = opts?.body ?? "";
  const wantsTrim = /\btrim\b|\bcut (the |it )?(start|beginning|end)\b|\bshorten\b/i.test(body);
  const wantsOverlay = /\b(text|overlay|title|headline)\b/i.test(body);

  if (wantsTrim || wantsOverlay) {
    const edited = await lightEditVideo(
      blob.bytes,
      {
        trimStartSec: /\b(start|beginning)\b/i.test(body) ? 0.5 : undefined,
        textOverlay: wantsOverlay ? overlayMasthead(brand).slice(0, 24) || undefined : undefined,
      },
      video.content_type,
    );
    if (edited) {
      mediaId = await storeVideoAsset(brand.id, new Uint8Array(edited.video), "video/mp4");
      if (edited.coverJpeg) coverId = await storePhotoAsset(brand.id, edited.coverJpeg);
    }
  } else {
    // Always try a cover frame for the approval preview.
    const frames = await extractVideoFrames(blob.bytes, { count: 1, contentType: video.content_type });
    if (frames[0]) coverId = await storePhotoAsset(brand.id, frames[0]);
  }

  const { caption } = await draftCaption(brand.id, [video.id], { asReel: true });

  const pillars = opts?.pillar ? [opts.pillar] : await ensurePillars(brand.id);
  const pillar =
    opts?.pillar ??
    (await classifyPhotoPillar(brand, pillars, coverId ?? video.id).catch(() => pillars[0])) ??
    pillars[0];

  const slot = await scheduleSlot({
    brandId: brand.id,
    platform: "instagram",
    pillarId: pillar?.id ?? null,
    postsPerWeek: pillar?.posts_per_week ?? 0,
    format: "reel",
  });

  // Reels always wait for approval (video is high-stakes / AIGC-adjacent).
  const post = await queryOne<Post>(
    `insert into posts (brand_id, caption, media_ids, source_media_ids, style_meta, format, pillar_id, is_auto, platform, status, scheduled_at)
     values ($1, $2, $3::uuid[], $4::uuid[], $5::jsonb, 'reel', $6, false, 'instagram', 'pending_approval', $7)
     returning *`,
    [
      brand.id,
      caption,
      [mediaId],
      [video.id],
      JSON.stringify({
        reel: true,
        cover_media_id: coverId,
        aigc: false,
        probe: validation.probe,
      }),
      pillar?.id ?? null,
      slot.toISOString(),
    ],
  );
  if (!post) return { ok: false, sms: "I drafted the caption but couldn't save the Reel. Try again?" };

  await query(
    `insert into approval_log (post_id, brand_id, action, actor, after, note)
     values ($1, $2, 'draft_created', 'system', $3::jsonb, $4)`,
    [
      post.id,
      brand.id,
      JSON.stringify({ caption, format: "reel", media_id: mediaId }),
      "Reel drafted from client video",
    ],
  ).catch(() => {});

  return {
    ok: true,
    post,
    mediaUrl: publicMediaUrl(mediaId),
    coverUrl: coverId ? publicMediaUrl(coverId) : null,
  };
}

/**
 * Build a Reel from still photos via motion template. On failure, caller should
 * draft a static feed post and use videoEditFallbackSms.
 */
export async function draftReelFromStills(
  brand: Brand,
  photoIds: string[],
  pillar: Pillar,
): Promise<{ ok: true; post: Post; mediaUrl: string | null; coverUrl: string | null } | { ok: false; reason: "no_ffmpeg" | "failed" }> {
  const stills: Buffer[] = [];
  for (const id of photoIds.slice(0, 6)) {
    const blob = await getMedia(id);
    if (!blob) continue;
    try {
      const framed = await sharp(Buffer.from(blob.bytes))
        .rotate()
        .resize({ width: 1080, height: 1920, fit: "cover" })
        .jpeg({ quality: 90 })
        .toBuffer();
      stills.push(framed);
    } catch {
      /* skip undecodable */
    }
  }
  if (stills.length === 0) return { ok: false, reason: "failed" };

  const motion = await motionFromStills(stills, {
    mode: stills.length === 1 ? "kenburns" : "slideshow",
  });
  if (!motion) {
    const avail = await detectFfmpeg();
    return { ok: false, reason: avail.ffmpeg ? "failed" : "no_ffmpeg" };
  }

  const videoId = await storeVideoAsset(brand.id, new Uint8Array(motion), "video/mp4");
  const coverId = await storePhotoAsset(brand.id, stills[0]!);
  const { caption } = await draftCaption(brand.id, photoIds.slice(0, 4), { asReel: true });

  const slot = await scheduleSlot({
    brandId: brand.id,
    platform: "instagram",
    pillarId: pillar.id,
    postsPerWeek: pillar.posts_per_week,
    format: "reel",
  });

  const post = await queryOne<Post>(
    `insert into posts (brand_id, caption, media_ids, source_media_ids, style_meta, format, pillar_id, is_auto, platform, status, scheduled_at)
     values ($1, $2, $3::uuid[], $4::uuid[], $5::jsonb, 'reel', $6, false, 'instagram', 'pending_approval', $7)
     returning *`,
    [
      brand.id,
      caption,
      [videoId],
      photoIds,
      JSON.stringify({ reel: true, cover_media_id: coverId, motion: true, aigc: false }),
      pillar.id,
      slot.toISOString(),
    ],
  );
  if (!post) return { ok: false, reason: "failed" };

  await query(
    `insert into approval_log (post_id, brand_id, action, actor, after, note)
     values ($1, $2, 'draft_created', 'system', $3::jsonb, $4)`,
    [
      post.id,
      brand.id,
      JSON.stringify({ caption, format: "reel", motion: true }),
      "Reel from stills (motion template)",
    ],
  ).catch(() => {});

  return {
    ok: true,
    post,
    mediaUrl: publicMediaUrl(videoId),
    coverUrl: publicMediaUrl(coverId),
  };
}

/** Run ffmpeg with streamed args (for long encodes). Unused helper kept for callers. */
export function spawnFfmpeg(args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}
