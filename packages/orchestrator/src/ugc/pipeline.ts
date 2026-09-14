import {
  getServerEnv,
  query,
  queryOne,
  publicMediaUrl,
  getMedia,
  type AiVideoJob,
  type Brand,
  type Post,
} from "@pulse/shared";
import { callLLM } from "../llm.js";
import { draftCaption } from "../draftCaption.js";
import { scheduleSlot } from "../scheduler.js";
import { ensurePillars } from "../pillars.js";
import { storeVideoAsset, storePhotoAsset } from "../video.js";
import { costEstimateSmsLine, estimateCost } from "../costEstimate.js";
import { assertAiSpendAllowed, recordAiSpend } from "../aiSpend.js";
import { brandContextForPrompt } from "../brandContext.js";
import {
  PRESETS_V1,
  SCRIPT_SYSTEM,
  SCRIPT_BANNED,
  pickAngle,
  productOnlyStillPrompt,
  STILL_NEGATIVE,
  motionPromptForScene,
  MOTION_NEGATIVE,
  MOTION_SECONDS_PER_SCENE,
} from "./presets/index.js";
import { falConfigured, falGenerateImageRouted, falImageToVideoRouted, describeUgcModelChains } from "./falClient.js";
import { elevenLabsConfigured, synthesizeUgcVoiceover } from "./elevenLabs.js";
import { assembleUgcReel } from "./assemble.js";
import { planUgcCreative, summarizeCreativePlan, type UgcCreativePlan } from "./creativePlan.js";
import {
  hardGateUgc,
  scoreUgcStill,
  scoreUgcAudioHeuristic,
  logUgcTune,
  looksLikeUgcRetune,
  parseUgcRetune,
  type UgcRetuneHint,
} from "./score.js";

export { looksLikeUgcRetune, parseUgcRetune };
export type { UgcRetuneHint };

export type UgcDestination = "organic" | "ads" | "both";

export type UgcScriptScene = {
  role: "hook" | "proof" | "cta" | string;
  vo: string;
  visual: string;
  seconds?: number;
};

export type UgcScript = {
  angle: string;
  hook: string;
  script: string;
  scenes: UgcScriptScene[];
  cta: string;
};

export function looksLikeUgcRequest(body: string | null | undefined): boolean {
  if (!body) return false;
  return (
    /\b(ugc|ugc[- ]?(ad|reel|video|clip)|user[- ]generated)\b/i.test(body) ||
    /\b(make|create|generate|shoot)\b.{0,40}\b(ugc|ad video|video ad|meta ad|facebook ad|tiktok ad)\b/i.test(
      body,
    ) ||
    /\b(ad creative|paid creative|video creative)\b/i.test(body)
  );
}

export function ugcDestinationFromBody(body: string): UgcDestination {
  if (/\b(ad|ads|paid|boost|meta ad|facebook ad)\b/i.test(body) && /\b(reel|organic|post)\b/i.test(body)) {
    return "both";
  }
  if (/\b(ad|ads|paid|boost|meta ad|facebook ad|tiktok ad)\b/i.test(body)) return "ads";
  return "organic";
}

export function ugcConfigured(): boolean {
  return falConfigured() && elevenLabsConfigured();
}

function talkingHeadEnabled(): boolean {
  if (PRESETS_V1.talkingHeadEnabled) return true;
  try {
    return Boolean(getServerEnv().UGC_TALKING_HEAD_ENABLED);
  } catch {
    return process.env.UGC_TALKING_HEAD_ENABLED === "true";
  }
}

function ugcEstCostCents(): number {
  try {
    return getServerEnv().UGC_EST_COST_CENTS;
  } catch {
    return Number(process.env.UGC_EST_COST_CENTS ?? 150);
  }
}

async function monthSpendCents(brandId: string): Promise<number> {
  const row = await queryOne<{ n: number }>(
    `select coalesce(sum(cost_cents), 0)::int as n from ai_video_jobs
      where brand_id = $1
        and status in ('queued','running','ready')
        and created_at >= date_trunc('month', now())`,
    [brandId],
  );
  return Number(row?.n ?? 0);
}

function costCapCents(): number {
  try {
    return getServerEnv().AI_VIDEO_COST_CAP_CENTS_MONTH;
  } catch {
    return Number(process.env.AI_VIDEO_COST_CAP_CENTS_MONTH ?? 2000);
  }
}

export type QueueUgcResult =
  | { ok: true; job: AiVideoJob; sms: string }
  | { ok: false; sms: string };

/**
 * Queue a multi-scene UGC job (routed stills → routed I2V → ElevenLabs → ffmpeg).
 * Kip auto-picks still/motion/voice per brief (Nano Banana/Flux/Seedream + Kling/Seedance/Wan
 * + voice slots) unless env pins a model. Product refs strongly preferred.
 */
export async function queueUgcJob(
  brand: Brand,
  brief: string,
  sourceMediaIds: string[] = [],
  destination: UgcDestination = "organic",
  retune: UgcRetuneHint | null = null,
): Promise<QueueUgcResult> {
  if (!ugcConfigured()) {
    return {
      ok: false,
      sms: "UGC video isn't fully set up yet (need fal key + ElevenLabs). Kip auto-picks stills/motion/voice for each brief. Send a clip and I'll draft a Reel — or ask for a plain AI video.",
    };
  }

  if (PRESETS_V1.requireProductRefs && sourceMediaIds.length === 0) {
    return {
      ok: false,
      sms: 'For UGC that doesn\'t look fake, send 1–3 product photos first, then say e.g. "make a UGC ad for our Saturday special".',
    };
  }

  const weeklyBlock = assertAiSpendAllowed(brand, "video");
  if (weeklyBlock) return { ok: false, sms: weeklyBlock };

  const est = ugcEstCostCents();
  const spent = await monthSpendCents(brand.id);
  const cap = costCapCents();
  if (spent + est > cap) {
    return {
      ok: false,
      sms: `We've hit this month's AI video budget (~$${(cap / 100).toFixed(0)}). I can still draft Reels from clips you send — or wait until next month.`,
    };
  }

  const clean = brief.replace(/\s+/g, " ").trim().slice(0, 800);
  if (clean.length < 8) {
    return {
      ok: false,
      sms: 'Tell me the offer/angle — e.g. "UGC reel for our oat flat white, busy mornings without the crash".',
    };
  }

  if (/\btalking head|avatar|creator face\b/i.test(clean) && !talkingHeadEnabled()) {
    return {
      ok: false,
      sms: "Talking-head UGC is still behind a flag — I can do product-first UGC (looks more natural). Send product photos + the offer and I'll make that.",
    };
  }

  const dest = destination || ugcDestinationFromBody(clean);
const creative = planUgcCreative({
    brief: clean,
    brand,
    hasProductRefs: sourceMediaIds.length > 0,
    destination: dest,
  });
  const chains = describeUgcModelChains(creative);
  const pipeline = {
    version: PRESETS_V1.version,
    destination: dest,
    angle: pickAngle(clean),
    retune: retune,
    model_chains: chains,
    creative: {
      mode: creative.mode,
      voiceSlot: creative.voiceSlot,
      reasons: creative.reasons,
      still: creative.still.map((c) => c.id),
      motion: creative.motion.map((c) => c.id),
    },
  };

  const job = await queryOne<AiVideoJob>(
    `insert into ai_video_jobs
       (brand_id, prompt, status, provider, model, source_media_ids, cost_cents, aigc, kind, destination, pipeline, preset_version)
     values ($1, $2, 'queued', 'fal', $3, $4::uuid[], $5, true, 'ugc', $6, $7::jsonb, $8)
     returning *`,
    [
      brand.id,
      clean,
      `ugc:${chains.still.map((c) => c.id).join(">")}+${chains.motion.map((c) => c.id).join(">")}+${creative.voiceSlot}`,
      sourceMediaIds,
      est,
      dest,
      JSON.stringify(pipeline),
      PRESETS_V1.version,
    ],
  );
  if (!job) {
    return { ok: false, sms: "Couldn't queue that UGC just then. Try again in a moment?" };
  }

  await recordAiSpend(brand.id, "video", estimateCost({ kind: "video" }).usd).catch(() => {});

  return {
    ok: true,
    job,
    sms: `On it — cooking a UGC-style ${dest === "ads" ? "ad" : "Reel"} (AIGC; Kip picked ${summarizeCreativePlan(creative)}; auto-tune on) ${costEstimateSmsLine("video")}. I'll text when it's ready for approval 🎬`,
  };
}

async function productRefUrls(mediaIds: string[]): Promise<string[]> {
  const urls: string[] = [];
  for (const id of mediaIds.slice(0, 4)) {
    urls.push(publicMediaUrl(id));
  }
  return urls;
}

async function generateScript(brand: Brand, brief: string, retune?: UgcRetuneHint | null): Promise<UgcScript> {
  const ctx = brandContextForPrompt(brand);
  const angle = pickAngle(brief);
  const retuneLine =
    retune === "more_casual"
      ? "Make it more casual and fragmented."
      : retune === "shorter"
        ? "Cut to ~40 words max."
        : retune === "different_hook"
          ? "Write a completely different hook with a fresh constraint."
          : retune === "more_product"
            ? "Center every scene on the product in-hand or on the counter."
            : retune === "less_face"
              ? "No faces — product and hands only."
              : "";

  const raw = await callLLM({
    system: SCRIPT_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Brand context:\n${ctx.slice(0, 1200)}\n\nAngle preference: ${angle}\nBrief: ${brief}\n${retuneLine}\nAvoid: ${SCRIPT_BANNED.join(", ")}`,
      },
    ],
    maxTokens: 700,
  });

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const parsed = JSON.parse(raw.slice(start, end + 1)) as Partial<UgcScript>;
  const scenes = Array.isArray(parsed.scenes) ? parsed.scenes : [];
  if (!parsed.script || scenes.length < 2) {
    throw new Error("ugc script parse failed");
  }
  const audio = scoreUgcAudioHeuristic(parsed.script);
  if (!audio.pass) {
    // One soft rewrite nudge inline
    const retry = await callLLM({
      system: SCRIPT_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Rewrite more conversational (fillers/ellipses OK). Prior script felt ${audio.notes}. Brief: ${brief}`,
        },
      ],
      maxTokens: 700,
    });
    const s2 = retry.indexOf("{");
    const e2 = retry.lastIndexOf("}");
    const p2 = JSON.parse(retry.slice(s2, e2 + 1)) as Partial<UgcScript>;
    if (p2.script && Array.isArray(p2.scenes)) {
      return {
        angle: String(p2.angle ?? angle),
        hook: String(p2.hook ?? ""),
        script: String(p2.script),
        scenes: p2.scenes as UgcScriptScene[],
        cta: String(p2.cta ?? ""),
      };
    }
  }
  return {
    angle: String(parsed.angle ?? angle),
    hook: String(parsed.hook ?? ""),
    script: String(parsed.script),
    scenes: scenes as UgcScriptScene[],
    cta: String(parsed.cta ?? ""),
  };
}

async function stillForScene(opts: {
  brand: Brand;
  scene: UgcScriptScene;
  productUrls: string[];
  productLabel: string;
  stillChain: UgcCreativePlan["still"];
}): Promise<{ buf: Buffer; prompt: string; modelId: string; falId: string }> {
  const visual = opts.scene.visual || opts.productLabel;
  const prompt = productOnlyStillPrompt({
    productDescription: opts.productLabel,
    context: visual,
  });
  let last: Buffer | null = null;
  let usedPrompt = prompt;
  let modelId = "unknown";
  let falId = "unknown";
  for (let attempt = 0; attempt <= PRESETS_V1.maxRegensPerScene; attempt++) {
    const patched =
      attempt === 0
        ? prompt
        : `${prompt} Extra: messier room, weaker beauty, stronger handheld, label sharper.`;
    usedPrompt = patched;
    const routed = await falGenerateImageRouted({
      prompt: patched,
      imageUrls: opts.productUrls.length ? opts.productUrls : undefined,
      aspectRatio: "9:16",
      negativePrompt: STILL_NEGATIVE,
      chain: opts.stillChain,
    });
    if (!routed) continue;
    last = routed.buffer;
    modelId = routed.modelId;
    falId = routed.falId;
    const score = await scoreUgcStill({
      sceneRole: opts.scene.role,
      promptUsed: patched,
      frameHint: `product-first UGC still for ${opts.productLabel}; attempt ${attempt}; model ${routed.label}`,
    });
    await logUgcTune({
      brandId: opts.brand.id,
      presetId: `still/${PRESETS_V1.version}/${routed.modelId}`,
      sceneIndex: null,
      scores: { ...(score as unknown as Record<string, unknown>), modelId: routed.modelId, falId: routed.falId },
      promptDelta: attempt ? { attempt, patched: true } : { modelId: routed.modelId },
      passed: score.pass,
    });
    if (score.pass) break;
  }
  if (!last) throw new Error("still generation failed across model chain");
  return { buf: last, prompt: usedPrompt, modelId, falId };
}

async function motionForStill(opts: {
  stillUrl: string;
  scene: UgcScriptScene;
  motionChain: UgcCreativePlan["motion"];
}): Promise<{ buf: Buffer; modelId: string; falId: string }> {
  const prompt = motionPromptForScene({
    role: opts.scene.role,
    visual: opts.scene.visual,
    intensity: PRESETS_V1.motionIntensity,
  });
  let last: Buffer | null = null;
  let modelId = "unknown";
  let falId = "unknown";
  for (let attempt = 0; attempt <= PRESETS_V1.maxRegensPerScene; attempt++) {
    const patched =
      attempt === 0 ? prompt : `${prompt}. Even subtler handheld shake, no morphing.`;
    const routed = await falImageToVideoRouted({
      prompt: patched,
      startImageUrl: opts.stillUrl,
      duration: String(opts.scene.seconds ?? MOTION_SECONDS_PER_SCENE),
      negativePrompt: MOTION_NEGATIVE,
      generateAudio: false,
      chain: opts.motionChain,
    });
    if (!routed) continue;
    last = routed.buffer;
    modelId = routed.modelId;
    falId = routed.falId;
    break;
  }
  if (!last) throw new Error("motion generation failed across model chain (kling/seedance/wan)");
  return { buf: last, modelId, falId };
}

/**
 * Process a queued UGC job → pending_approval Reel (AIGC), optional ads-ready media.
 */
export async function processUgcJob(
  jobId: string,
): Promise<{ brandId: string; sms: string; mediaUrl?: string } | null> {
  const job = await queryOne<AiVideoJob & { kind?: string; destination?: string; pipeline?: Record<string, unknown> }>(
    `select * from ai_video_jobs where id = $1`,
    [jobId],
  );
  if (!job || job.status !== "queued") return null;
  if ((job as { kind?: string }).kind && (job as { kind?: string }).kind !== "ugc") return null;

  await query(`update ai_video_jobs set status = 'running', updated_at = now() where id = $1`, [jobId]);

  const brand = await queryOne<Brand>(`select * from brands where id = $1`, [job.brand_id]);
  if (!brand) {
    await query(
      `update ai_video_jobs set status = 'failed', error = 'brand missing', updated_at = now(), completed_at = now() where id = $1`,
      [jobId],
    );
    return null;
  }

  try {
    const sourceIds = job.source_media_ids ?? [];
    const gate = hardGateUgc({
      hasProductRefs: sourceIds.length > 0,
      requireProductRefs: PRESETS_V1.requireProductRefs,
      durationSec: 18,
      hasVo: true,
      aigc: true,
    });
    if (!gate.ok) {
      throw new Error(gate.reason ?? "hard_gate");
    }

    const pipeline = (job as { pipeline?: { retune?: UgcRetuneHint } }).pipeline ?? {};
    const script = await generateScript(brand, job.prompt, pipeline.retune ?? null);
    const productUrls = await productRefUrls(sourceIds);
    const productLabel =
      brand.name +
      (/\bfor\b/i.test(job.prompt) ? ` — ${job.prompt.replace(/^.*?for\s+/i, "").slice(0, 80)}` : " product");

    const creative = planUgcCreative({
      brief: job.prompt,
      brand,
      hasProductRefs: sourceIds.length > 0,
      destination: ((job as { destination?: UgcDestination }).destination as UgcDestination) || "organic",
    });

    // VO first (timing driver) — Kip-picked voice slot unless UGC_VOICE_MODE=fixed
    const vo = await synthesizeUgcVoiceover({ text: script.script, slot: creative.voiceSlot });
    if (!vo) throw new Error("voiceover failed");

    const sceneClips: Array<{ video: Buffer; voText: string }> = [];
    const stillMediaIds: string[] = [];
    const modelsUsed: Array<{ scene: string; still?: string; motion?: string }> = [];

    for (const scene of script.scenes.slice(0, 3)) {
      const still = await stillForScene({ brand, scene, productUrls, productLabel, stillChain: creative.still });
      const stillId = await storePhotoAsset(brand.id, still.buf);
      stillMediaIds.push(stillId);
      const stillUrl = publicMediaUrl(stillId);
      const motion = await motionForStill({ stillUrl, scene, motionChain: creative.motion });
      sceneClips.push({ video: motion.buf, voText: scene.vo });
      modelsUsed.push({
        scene: scene.role,
        still: still.modelId,
        motion: motion.modelId,
      });
    }

    const reelBuf = await assembleUgcReel({
      scenes: sceneClips,
      voiceoverMp3: vo,
      fullScript: script.script,
    });

    const mediaId = await storeVideoAsset(brand.id, new Uint8Array(reelBuf), "video/mp4");
    let coverId: string | null = stillMediaIds[0] ?? null;

    const { caption } = await draftCaption(brand.id, coverId ? [coverId] : [mediaId], {
      asReel: true,
      hint: `UGC-style AIGC Reel. Hook: ${script.hook}. Do not claim this was filmed by a real customer.`,
    });
    const aigcCaption = /aigc|ai[- ]generated|synthetic/i.test(caption)
      ? caption
      : `${caption}\n\n(AIGC)`;

    const pillars = await ensurePillars(brand.id);
    const pillar = pillars[0];
    const slot = await scheduleSlot({
      brandId: brand.id,
      platform: "instagram",
      pillarId: pillar?.id ?? null,
      postsPerWeek: pillar?.posts_per_week ?? 0,
      format: "reel",
    });

    const dest = (job as { destination?: string }).destination ?? "organic";
    const post = await queryOne<Post>(
      `insert into posts (brand_id, caption, media_ids, source_media_ids, style_meta, format, pillar_id, is_auto, platform, status, scheduled_at)
       values ($1, $2, $3::uuid[], $4::uuid[], $5::jsonb, 'reel', $6, false, 'instagram', 'pending_approval', $7)
       returning *`,
      [
        brand.id,
        aigcCaption,
        [mediaId],
        sourceIds,
        JSON.stringify({
          reel: true,
          aigc: true,
          ugc: true,
          ai_video_job_id: job.id,
          preset_version: PRESETS_V1.version,
          destination: dest,
          usable_as: dest === "ads" ? ["paid_creative"] : dest === "both" ? ["organic_reel", "paid_creative"] : ["organic_reel", "paid_creative"],
          cover_media_id: coverId,
          script_hook: script.hook,
        }),
        pillar?.id ?? null,
        slot.toISOString(),
      ],
    );

    await query(
      `update ai_video_jobs
          set status = 'ready', result_media_id = $2, post_id = $3,
              pipeline = coalesce(pipeline, '{}'::jsonb) || $4::jsonb,
              updated_at = now(), completed_at = now()
        where id = $1`,
      [
        jobId,
        mediaId,
        post?.id ?? null,
        JSON.stringify({
          script,
          still_media_ids: stillMediaIds,
          assembled: true,
          models_used: modelsUsed,
          model_chains: describeUgcModelChains(creative),
        }),
      ],
    );

    await logUgcTune({
      brandId: brand.id,
      jobId,
      presetId: `pipeline/${PRESETS_V1.version}`,
      scores: { scenes: script.scenes.length, dest, modelsUsed },
      passed: true,
    });

    const when = post?.scheduled_at
      ? new Date(post.scheduled_at).toLocaleString("en-AU", {
          weekday: "short",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        })
      : "soon";

    const destLine =
      dest === "ads"
        ? `This is tagged as paid creative — reply "yes" to keep the draft, then ask me to run ads with it.`
        : dest === "both"
          ? `Usable as organic Reel or paid creative. Reply "yes" to approve the Reel, or "run ads with this".`
          : `Proposed for ${when}. Reply "yes" to approve as a Reel — or say "run ads with this".`;

    return {
      brandId: brand.id,
      sms: `Your UGC-style video is ready (AIGC) 🎬\n\n"${aigcCaption}"\n\n${destLine}`,
      mediaUrl: coverId ? publicMediaUrl(coverId) : publicMediaUrl(mediaId),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await query(
      `update ai_video_jobs set status = 'failed', error = $2, updated_at = now(), completed_at = now() where id = $1`,
      [jobId, msg.slice(0, 500)],
    );
    return {
      brandId: brand.id,
      sms: "Couldn't finish that UGC video just then (provider/assembly glitch). Want to try again with clearer product photos, or send a real clip instead?",
    };
  }
}

/** Re-queue latest ready/failed UGC with a soft retune hint (cheaper than full new brief). */
export async function queueUgcRetune(brand: Brand, body: string): Promise<QueueUgcResult> {
  const hint = parseUgcRetune(body);
  const prev = await queryOne<AiVideoJob & { destination?: string }>(
    `select * from ai_video_jobs
      where brand_id = $1 and kind = 'ugc' and status in ('ready','failed')
      order by created_at desc limit 1`,
    [brand.id],
  );
  if (!prev) {
    return { ok: false, sms: "I don't have a recent UGC job to tweak — send product photos and ask for a new UGC ad/reel." };
  }
  // Strip prior [retune:…] tags so we don't stack them; pass hint via pipeline.retune.
  const basePrompt = prev.prompt.replace(/\n*\[retune:[^\]]+\]/g, "").trim();
  return queueUgcJob(
    brand,
    basePrompt,
    prev.source_media_ids ?? [],
    ((prev as { destination?: UgcDestination }).destination as UgcDestination) || "organic",
    hint,
  );
}

// silence unused import in some build configs
void getMedia;
