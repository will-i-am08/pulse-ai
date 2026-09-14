/** ffmpeg assembly presets for Reels / TikTok / Meta UGC ads. */

export const ASSEMBLY_V1 = {
  width: 1080,
  height: 1920,
  fps: 30,
  videoCodec: "libx264",
  audioCodec: "aac",
  audioBitrate: "128k",
  crf: 20,
  minTotalSec: 12,
  maxTotalSec: 30,
  idealAdSec: 20,
  silenceTrimMs: 350,
  captionWordsPerChunk: 5,
  captionPadSec: 0.2,
  hookZoom: 1.06,
} as const;

export const CAPTION_STYLE = {
  fontsize: 48,
  fontcolor: "white",
  borderw: 3,
  bordercolor: "black",
  x: "(w-text_w)/2",
  y: "h*0.72",
} as const;
