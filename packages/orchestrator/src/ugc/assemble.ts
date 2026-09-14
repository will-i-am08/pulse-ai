import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnFfmpeg, probeVideo } from "../video.js";
import { ASSEMBLY_V1, CAPTION_STYLE } from "./presets/assemblyPresets.js";
import { MOTION_SECONDS_PER_SCENE } from "./presets/motionPresets.js";

export type UgcSceneClip = {
  video: Buffer;
  voText: string;
};

async function writeTemp(buf: Buffer, ext: string): Promise<string> {
  const p = join(tmpdir(), `ugc-${randomUUID()}.${ext}`);
  await fs.writeFile(p, buf);
  return p;
}

async function rmQuiet(...paths: string[]) {
  await Promise.all(paths.map((p) => fs.unlink(p).catch(() => undefined)));
}

/**
 * Escape text for an ffmpeg `drawtext=text='...'` single-quoted section.
 *
 * Inside a single-quoted filtergraph section a backslash is NOT an escape, so
 * the old `\\'` left the quote live: "don't" closed the string early, corrupted
 * the filtergraph and killed the job at the very last step — after all three
 * stills, all three motion renders and the ElevenLabs call had been paid for.
 * The only portable idiom is close-quote / escaped-quote / reopen: '\''
 *
 * `:` must NOT be escaped here either — the surrounding quotes already protect
 * it, and escaping rendered a literal backslash in the burned caption.
 */
export function escapeDrawtext(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, " ")
    .replace(/'/g, "'\\''");
}

/** Shortest a caption may stay on screen and still be readable. */
const MIN_CHUNK_SEC = 0.9;

/**
 * Spread caption chunks across the REAL timeline instead of a hardcoded 2.2s
 * cadence. The old schedule ran 52.8s of captions over a 12s video, so roughly
 * three-quarters of the on-screen text never rendered at all.
 *
 * Chunks that cannot be given a readable slot are dropped rather than scheduled
 * past the end of the video, where they would silently vanish.
 */
export function captionSchedule(
  chunkCount: number,
  totalSec: number,
): Array<{ start: number; end: number }> {
  if (chunkCount <= 0 || !(totalSec > 0)) return [];
  const fits = Math.max(1, Math.min(chunkCount, Math.floor(totalSec / MIN_CHUNK_SEC)));
  const per = totalSec / fits;
  const out: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < fits; i++) {
    const start = i * per;
    out.push({ start, end: Math.min(totalSec, start + per) });
  }
  return out;
}

function captionChunks(text: string, wordsPerChunk: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += wordsPerChunk) {
    chunks.push(words.slice(i, i + wordsPerChunk).join(" "));
  }
  return chunks.length ? chunks : [text.slice(0, 40)];
}

/** Stitch scene MP4s + VO into a 9:16 Reel with burned captions. */
export async function assembleUgcReel(opts: {
  scenes: UgcSceneClip[];
  voiceoverMp3: Buffer;
  fullScript: string;
}): Promise<Buffer> {
  const work: string[] = [];
  try {
    const voPath = await writeTemp(opts.voiceoverMp3, "mp3");
    work.push(voPath);

    const scenePaths: string[] = [];
    for (const scene of opts.scenes) {
      const sp = await writeTemp(scene.video, "mp4");
      work.push(sp);
      scenePaths.push(sp);
    }

    const normPaths: string[] = [];
    for (let i = 0; i < scenePaths.length; i++) {
      const out = join(tmpdir(), `ugc-norm-${randomUUID()}.mp4`);
      work.push(out);
      const zoom = i === 0 ? ASSEMBLY_V1.hookZoom : 1;
      const vf =
        zoom > 1
          ? `scale=${ASSEMBLY_V1.width}:${ASSEMBLY_V1.height}:force_original_aspect_ratio=increase,crop=${ASSEMBLY_V1.width}:${ASSEMBLY_V1.height},zoompan=z='min(${zoom},zoom+0.0015)':d=1:s=${ASSEMBLY_V1.width}x${ASSEMBLY_V1.height}`
          : `scale=${ASSEMBLY_V1.width}:${ASSEMBLY_V1.height}:force_original_aspect_ratio=increase,crop=${ASSEMBLY_V1.width}:${ASSEMBLY_V1.height}`;
      const code = await spawnFfmpeg([
        "-y",
        "-i",
        scenePaths[i]!,
        "-vf",
        vf,
        "-r",
        String(ASSEMBLY_V1.fps),
        "-an",
        "-c:v",
        ASSEMBLY_V1.videoCodec,
        "-crf",
        String(ASSEMBLY_V1.crf),
        "-pix_fmt",
        "yuv420p",
        out,
      ]);
      if (code !== 0) throw new Error(`ffmpeg normalize scene ${i} exit ${code}`);
      normPaths.push(out);
    }

    const listPath = join(tmpdir(), `ugc-list-${randomUUID()}.txt`);
    work.push(listPath);
    await fs.writeFile(
      listPath,
      normPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"),
    );

    const concatPath = join(tmpdir(), `ugc-concat-${randomUUID()}.mp4`);
    work.push(concatPath);
    {
      const code = await spawnFfmpeg([
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listPath,
        "-c",
        "copy",
        concatPath,
      ]);
      if (code !== 0) throw new Error(`ffmpeg concat exit ${code}`);
    }

    // Real durations drive both the caption schedule and the output length.
    const voSec = (await probeVideo(opts.voiceoverMp3, "audio/mpeg").catch(() => null))?.durationSec ?? 0;
    const concatBytes = await fs.readFile(concatPath);
    const probedVideoSec = (await probeVideo(concatBytes, "video/mp4").catch(() => null))?.durationSec ?? 0;
    const videoSec =
      probedVideoSec > 0
        ? probedVideoSec
        : Math.max(1, opts.scenes.length) * MOTION_SECONDS_PER_SCENE;
    // `-shortest` used to cut the output to the video, decapitating a longer
    // voiceover mid-sentence — and the CTA is the tail of the script.
    const padSec = voSec > videoSec ? voSec - videoSec : 0;
    const totalSec = Math.max(videoSec, voSec);

    const chunks = captionChunks(opts.fullScript, ASSEMBLY_V1.captionWordsPerChunk);
    const schedule = captionSchedule(chunks.length, totalSec);
    const drawtexts = schedule
      .map((slot, i) => {
        const t = escapeDrawtext(chunks[i]!);
        return `drawtext=text='${t}':fontsize=${CAPTION_STYLE.fontsize}:fontcolor=${CAPTION_STYLE.fontcolor}:borderw=${CAPTION_STYLE.borderw}:bordercolor=${CAPTION_STYLE.bordercolor}:x=${CAPTION_STYLE.x}:y=${CAPTION_STYLE.y}:enable='between(t,${slot.start.toFixed(2)},${slot.end.toFixed(2)})'`;
      })
      .join(",");
    // Clone the last frame to cover a longer VO rather than truncating it.
    const padFilter = padSec > 0 ? `tpad=stop_mode=clone:stop_duration=${padSec.toFixed(2)}` : "";
    const vf = [padFilter, drawtexts].filter(Boolean).join(",") || "null";

    const outPath = join(tmpdir(), `ugc-out-${randomUUID()}.mp4`);
    work.push(outPath);
    {
      const code = await spawnFfmpeg([
        "-y",
        "-i",
        concatPath,
        "-i",
        voPath,
        "-vf",
        vf,
        "-c:v",
        ASSEMBLY_V1.videoCodec,
        "-crf",
        String(ASSEMBLY_V1.crf),
        "-c:a",
        ASSEMBLY_V1.audioCodec,
        "-b:a",
        ASSEMBLY_V1.audioBitrate,
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        outPath,
      ]);
      if (code !== 0) throw new Error(`ffmpeg mux/captions exit ${code}`);
    }

    return await fs.readFile(outPath);
  } finally {
    await rmQuiet(...work);
  }
}
