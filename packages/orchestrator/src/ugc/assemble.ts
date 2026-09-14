import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnFfmpeg } from "../video.js";
import { ASSEMBLY_V1, CAPTION_STYLE } from "./presets/assemblyPresets.js";

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

function escapeDrawtext(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/\n/g, " ");
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

    const chunks = captionChunks(opts.fullScript, ASSEMBLY_V1.captionWordsPerChunk);
    const drawtexts = chunks
      .map((chunk, i) => {
        const start = (i * 2.2).toFixed(2);
        const end = (i * 2.2 + 2.0).toFixed(2);
        const t = escapeDrawtext(chunk);
        return `drawtext=text='${t}':fontsize=${CAPTION_STYLE.fontsize}:fontcolor=${CAPTION_STYLE.fontcolor}:borderw=${CAPTION_STYLE.borderw}:bordercolor=${CAPTION_STYLE.bordercolor}:x=${CAPTION_STYLE.x}:y=${CAPTION_STYLE.y}:enable='between(t,${start},${end})'`;
      })
      .join(",");

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
        drawtexts || "null",
        "-c:v",
        ASSEMBLY_V1.videoCodec,
        "-crf",
        String(ASSEMBLY_V1.crf),
        "-c:a",
        ASSEMBLY_V1.audioCodec,
        "-b:a",
        ASSEMBLY_V1.audioBitrate,
        "-shortest",
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
