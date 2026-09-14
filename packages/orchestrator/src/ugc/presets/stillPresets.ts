/** Nano Banana / product-still presets — phone-feel UGC, not studio. */

export const STILL_NEGATIVE =
  "extra fingers, waxy plastic skin, beauty filter, deformed hands, mismatched eyes, studio lighting, cinematic color grade, CGI, floating product, warped label, beauty retouch, glossy commercial ad";

/** Extra bans for feed photo drafts — stops random AI prop clutter. */
export const FEED_PHOTO_NEGATIVE =
  `${STILL_NEGATIVE}, random water bottle, laptop, desktop computer, smartphone in frame, coffee cup unless essential, cluttered desk props, unrelated packaging, plastic CGI look, AI artifact, extra limbs, warped objects, illegible text, watermark, logo, typography in image, poster text, caption burned into photo`;

export function productOnlyStillPrompt(opts: {
  productDescription: string;
  context: string;
  timeOfDay?: string;
}): string {
  const tod = opts.timeOfDay ?? "daytime";
  return [
    `Candid smartphone photo of ${opts.productDescription} in ${opts.context},`,
    `shot on iPhone, natural ${tod} light, slight grain, authentic, unposed, vertical 9:16 composition.`,
    `Product label readable, real materials, slight handheld framing.`,
    `Not a studio product shot.`,
  ].join(" ");
}

export function productInHandStillPrompt(opts: {
  productDescription: string;
  hand: "left" | "right";
}): string {
  return [
    `Using product reference images: place ${opts.productDescription} naturally in the ${opts.hand} hand.`,
    `Scale to hand size and selfie distance. Match light direction; contact shadows on fingers/palm.`,
    `Fingers occlude product edges (no float); label readable.`,
    `Phone selfie UGC vibe, natural window light, chest-up framing if person visible.`,
    `Preserve realistic skin texture; no beauty filter.`,
  ].join(" ");
}

export function actorSelfiePrompt(opts: {
  age: string;
  gender: string;
  hair: string;
  room: string;
}): string {
  return [
    `Phone selfie, front camera, natural window light, casual UGC vibe.`,
    `Subject: ${opts.age} ${opts.gender}, natural skin texture, minimal makeup, ${opts.hair}, casual clothes.`,
    `Framing: chest-up, looking at camera, slight handheld feel.`,
    `Setting: ${opts.room}, daytime natural light.`,
    `Style: realistic photo, slight grain, iPhone quality — not studio.`,
  ].join(" ");
}

/** Default still mode for v1 — safer than faces. */
export const V1_STILL_MODE: "product_only" | "product_in_hand" | "talking_head" = "product_only";
