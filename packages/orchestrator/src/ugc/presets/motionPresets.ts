/** Kling I2V motion presets — short clips, subtle handheld UGC motion. */

export const MOTION_STYLE_LOCK =
  "handheld vertical UGC selfie, soft window light camera-left, smartphone quality, slight shake, natural blinks/micro-movement, authentic phone video";

export const MOTION_NEGATIVE =
  "frozen lips, jittery eyes, warping fingers, plastic skin, morphing label, sudden wardrobe change, cinematic crane, dolly zoom, morphing product, extra limbs";

export const MOTION_SECONDS_PER_SCENE = 4;

export function motionPromptForScene(opts: {
  role: "hook" | "proof" | "cta" | string;
  visual: string;
  intensity?: "subtle" | "medium";
}): string {
  const intensity = opts.intensity ?? "subtle";
  const action =
    opts.role === "hook"
      ? "slow push-in, product enters frame, slight handheld drift"
      : opts.role === "cta"
        ? "hold steady on product, gentle nod of framing, end on clear hero frame"
        : "slow product turn or reveal, micro handheld shake, natural motion";
  const motionAmt =
    intensity === "subtle"
      ? "very subtle camera motion only"
      : "moderate handheld motion, still believable as phone video";
  return [
    MOTION_STYLE_LOCK,
    opts.visual,
    action,
    motionAmt,
    "keep product identity and label stable",
  ].join(". ");
}
