import {
  getServerEnv,
  query,
  queryOne,
  publicMediaUrl,
  resetServerEnvCache,
  type AiVideoJob,
  type Brand,
  type Post,
} from "@pulse/shared";
import { draftCaption } from "./draftCaption.js";
import { scheduleSlot } from "./scheduler.js";
import { ensurePillars } from "./pillars.js";
import { storeVideoAsset, storePhotoAsset, extractVideoFrames } from "./video.js";
import { costEstimateSmsLine, estimateCost } from "./costEstimate.js";
import { assertAiSpendAllowed, recordAiSpend } from "./aiSpend.js";
import { processUgcJob } from "./ugc/pipeline.js";

/**
 * Phase G4 — AI video generation via gateway models (Kling primary, Runway secondary).
 * Env-configurable Replicate / fal models. Approve-gated, cost-capped, async SMS pattern.
 * Results are AIGC-labelled in style_meta.
 */

export type AiVideoProvider = "replicate" | "fal";

export type AiVideoRoute = {
  provider: AiVideoProvider;
  model: string;
  tier: "primary" | "secondary";
  reason: string;
};

export function looksLikeAiVideoRequest(body: string | null | undefined): boolean {
  if (!body) return false;
  // Prefer explicit generate / AI / text-to-video language — not plain "make a reel"
  // (that routes to motion-from-stills / client video).
  return /\b(generate|ai)\s+(a\s+|an\s+|me\s+a\s+)?(video|reel|clip)\b|\b(ai video|generate video|text to video|text-to-video|create an? ai (video|reel))\b|\bmake me an? ai (video|reel)\b/i.test(
    body,
  );
}

export function looksLikeMakeReelRequest(body: string | null | undefined): boolean {
  if (!body) return false;
  return /\b(?:(?:make|turn|put)\s+(?:it|this|these|that|them)?\s*(?:(?:in)?to\s+)?(?:a\s+)?reels?|as\s+(?:a\s+)?reels?|reels?\s+this|make\s+a\s+reel)\b|^\s*reels?\s*[!.?]*$/i.test(
    body,
  );
}

/** Resolve primary then secondary model from env. Null when AI video is disabled. */
export function routeAiVideo(prefer: "primary" | "secondary" = "primary"): AiVideoRoute | null {
  let provider: AiVideoProvider = "replicate";
  let primary: string | undefined;
  let secondary: string | undefined;
  try {
    const e = getServerEnv();
    provider = e.AI_VIDEO_PROVIDER;
    primary = e.AI_VIDEO_PRIMARY_MODEL;
    secondary = e.AI_VIDEO_SECONDARY_MODEL;
  } catch {
    provider = (process.env.AI_VIDEO_PROVIDER as AiVideoProvider) || "replicate";
    primary = process.env.AI_VIDEO_PRIMARY_MODEL || undefined;
    secondary = process.env.AI_VIDEO_SECONDARY_MODEL || undefined;
  }

  if (prefer === "primary" && primary) {
    return {
      provider,
      model: primary,
      tier: "primary",
      reason: "Kling-class primary model",
    };
  }
  if (secondary) {
    return {
      provider,
      model: secondary,
      tier: "secondary",
      reason: "Runway-class secondary model",
    };
  }
  // Deliberately NOT falling back to `primary` here: the caller asks for a
  // secondary only after the primary failed, so returning it retries the same
  // failing model and bills for it twice.
  return null;
}

export function aiVideoConfigured(): boolean {
  return routeAiVideo("primary") !== null || routeAiVideo("secondary") !== null;
}

async function monthSpendCents(brandId: string): Promise<number> {
  const row = await queryOne<{ n: number }>(
    `select coalesce(sum(cost_cents), 0)::int as n from ai_video_jobs
      where brand_id = $1
        and status in ('queued','running','ready','failed')
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

function estCostCents(): number {
  try {
    return getServerEnv().AI_VIDEO_EST_COST_CENTS;
  } catch {
    return Number(process.env.AI_VIDEO_EST_COST_CENTS ?? 50);
  }
}

export type QueueAiVideoResult =
  | { ok: true; job: AiVideoJob; sms: string }
  | { ok: false; sms: string };

/**
 * Queue an AI video job and reply immediately ("I'll text when ready").
 * Cost-capped per brand per calendar month + weekly AI spend cap (facts.ai_spend).
 */
export async function queueAiVideoJob(
  brand: Brand,
  prompt: string,
  sourceMediaIds: string[] = [],
): Promise<QueueAiVideoResult> {
  const route = routeAiVideo("primary") ?? routeAiVideo("secondary");
  if (!route) {
    return {
      ok: false,
      sms: "AI video isn't set up on this workspace yet (need Kling/Runway model env). Send a clip and I'll draft a Reel from that instead.",
    };
  }

  const weeklyBlock = assertAiSpendAllowed(brand, "video");
  if (weeklyBlock) {
    return { ok: false, sms: weeklyBlock };
  }

  const spent = await monthSpendCents(brand.id);
  const est = estCostCents();
  const cap = costCapCents();
  if (spent + est > cap) {
    return {
      ok: false,
      sms: `We've hit this month's AI video budget (~$${(cap / 100).toFixed(0)}). I can still draft Reels from clips you send — or wait until next month.`,
    };
  }

  const cleanPrompt = prompt.replace(/\s+/g, " ").trim().slice(0, 800);
  if (cleanPrompt.length < 8) {
    return {
      ok: false,
      sms: 'Tell me what the video should show — e.g. "generate a video of latte art in warm morning light".',
    };
  }

  const job = await queryOne<AiVideoJob>(
    `insert into ai_video_jobs (brand_id, prompt, status, provider, model, source_media_ids, cost_cents, aigc)
     values ($1, $2, 'queued', $3, $4, $5::uuid[], $6, true)
     returning *`,
    [brand.id, cleanPrompt, route.provider, route.model, sourceMediaIds, est],
  );
  if (!job) {
    return { ok: false, sms: "Couldn't queue that video just then. Try again in a moment?" };
  }

  await recordAiSpend(brand.id, "video", estimateCost({ kind: "video" }).usd).catch(() => {});

  return {
    ok: true,
    job,
    sms: `On it — generating an AI video (AIGC) ${costEstimateSmsLine("video")}. I'll text you when it's ready for approval.`,
  };
}

async function replicatePredict(model: string, input: Record<string, unknown>): Promise<Buffer | null> {
  const token = process.env.REPLICATE_API_TOKEN ?? (() => {
    try {
      return getServerEnv().REPLICATE_API_TOKEN;
    } catch {
      return undefined;
    }
  })();
  if (!token) return null;

  const res = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "wait",
    },
    body: JSON.stringify({ input }),
  });
  let body = (await res.json()) as {
    status?: string;
    output?: unknown;
    urls?: { get?: string };
    error?: string;
  };
  if (!res.ok && res.status !== 202) {
    throw new Error(`replicate ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  }
  const getUrl = body.urls?.get;
  for (let i = 0; i < 90 && body.status && body.status !== "succeeded"; i++) {
    if (body.status === "failed" || body.status === "canceled") {
      throw new Error(`replicate ${body.status}: ${body.error ?? ""}`);
    }
    await new Promise((r) => setTimeout(r, 3000));
    if (!getUrl) break;
    body = (await (await fetch(getUrl, { headers: { Authorization: `Bearer ${token}` } })).json()) as typeof body;
  }
  let out = body.output;
  if (Array.isArray(out)) out = out[0];
  if (typeof out !== "string") return null;
  return Buffer.from(await (await fetch(out)).arrayBuffer());
}

async function falPredict(model: string, input: Record<string, unknown>): Promise<Buffer | null> {
  const key =
    process.env.FAL_KEY ??
    (() => {
      try {
        return getServerEnv().FAL_KEY;
      } catch {
        return undefined;
      }
    })();
  if (!key) return null;

  const res = await fetch(`https://queue.fal.run/${model}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const submitted = (await res.json()) as {
    request_id?: string;
    status_url?: string;
    response_url?: string;
    video?: { url?: string };
    error?: string;
  };
  if (!res.ok) throw new Error(`fal ${res.status}: ${JSON.stringify(submitted).slice(0, 200)}`);

  // Poll status when queued.
  let statusUrl = submitted.status_url;
  let responseUrl = submitted.response_url;
  for (let i = 0; i < 90; i++) {
    if (responseUrl) {
      const done = await fetch(responseUrl, { headers: { Authorization: `Key ${key}` } });
      if (done.ok) {
        const payload = (await done.json()) as { video?: { url?: string }; video_url?: string };
        const url = payload.video?.url ?? payload.video_url;
        if (url) return Buffer.from(await (await fetch(url)).arrayBuffer());
      }
    }
    if (!statusUrl) break;
    await new Promise((r) => setTimeout(r, 3000));
    const st = await (
      await fetch(statusUrl, { headers: { Authorization: `Key ${key}` } })
    ).json() as { status?: string; response_url?: string; status_url?: string };
    if (st.response_url) responseUrl = st.response_url;
    if (st.status_url) statusUrl = st.status_url;
    if (st.status === "FAILED" || st.status === "failed") throw new Error("fal failed");
  }
  return null;
}

async function generateVideoBuffer(route: AiVideoRoute, prompt: string): Promise<Buffer | null> {
  const input =
    route.provider === "fal"
      ? { prompt, aspect_ratio: "9:16", duration: "5" }
      : { prompt, aspect_ratio: "9:16", duration: 5 };

  if (route.provider === "fal") return falPredict(route.model, input);
  return replicatePredict(route.model, input);
}

/**
 * Process one queued AI video job → pending_approval Reel (AIGC labelled).
 * Returns SMS text for the worker to deliver.
 */
export async function processAiVideoJob(
  jobId: string,
): Promise<{ brandId: string; sms: string; mediaUrl?: string; videoUrl?: string } | null> {
  const peek = await queryOne<AiVideoJob>(
    `select id, kind, status from ai_video_jobs where id = $1`,
    [jobId],
  );
  if (!peek || peek.status !== "queued") return null;
  // UGC multi-scene jobs are handled by processUgcJob (routed stills/motion models).
  if (peek.kind === "ugc") return null;

  // Atomic claim — without the status predicate two workers both "win" and both pay.
  const job = await queryOne<AiVideoJob>(
    `update ai_video_jobs set status = 'running', updated_at = now()
      where id = $1 and status = 'queued'
      returning *`,
    [jobId],
  );
  if (!job) return null;

  const brand = await queryOne<Brand>(`select * from brands where id = $1`, [job.brand_id]);
  if (!brand) {
    await query(
      `update ai_video_jobs set status = 'failed', error = 'brand missing', updated_at = now(), completed_at = now()
        where id = $1 and status = 'running'`,
      [jobId],
    );
    return null;
  }

  let route: AiVideoRoute | null = job.model
    ? {
        provider: (job.provider as AiVideoProvider) || "replicate",
        model: job.model,
        tier: "primary",
        reason: "job model",
      }
    : routeAiVideo("primary");

  let videoBuf: Buffer | null = null;
  let lastErr: string | null = null;

  for (const prefer of ["primary", "secondary"] as const) {
    const r = prefer === "primary" ? route : routeAiVideo("secondary");
    if (!r) continue;
    try {
      videoBuf = await generateVideoBuffer(r, job.prompt);
      if (videoBuf) {
        route = r;
        break;
      }
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      console.error(`processAiVideoJob: ${prefer} failed`, err);
      route = null;
    }
  }

  if (!videoBuf || !route) {
    await query(
      `update ai_video_jobs set status = 'failed', error = $2, updated_at = now(), completed_at = now()
        where id = $1 and status = 'running'`,
      [jobId, lastErr ?? "no output"],
    );
    return {
      brandId: brand.id,
      sms: "Couldn't generate that AI video just then (provider glitch). Want to try a different prompt, or send a clip instead?",
    };
  }

  const mediaId = await storeVideoAsset(brand.id, new Uint8Array(videoBuf), "video/mp4");
  let coverId: string | null = null;
  try {
    const frames = await extractVideoFrames(videoBuf, { count: 1, contentType: "video/mp4" });
    if (frames[0]) coverId = await storePhotoAsset(brand.id, frames[0]);
  } catch {
    /* cover optional */
  }

  const { caption } = await draftCaption(brand.id, coverId ? [coverId] : [], {
    asReel: true,
    hint: `AI-generated video prompt: ${job.prompt}. Caption as an organic Reel; do not claim it's documentary footage.`,
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

  const post = await queryOne<Post>(
    `insert into posts (brand_id, caption, media_ids, source_media_ids, style_meta, format, pillar_id, is_auto, platform, status, scheduled_at)
     values ($1, $2, $3::uuid[], $4::uuid[], $5::jsonb, 'reel', $6, false, 'instagram', 'pending_approval', $7)
     returning *`,
    [
      brand.id,
      aigcCaption,
      [mediaId],
      job.source_media_ids ?? [],
      JSON.stringify({
        reel: true,
        aigc: true,
        ai_video_job_id: job.id,
        model: route.model,
        provider: route.provider,
        cover_media_id: coverId,
        usable_as: ["organic_reel", "paid_creative"],
      }),
      pillar?.id ?? null,
      slot.toISOString(),
    ],
  );

  await query(
    `update ai_video_jobs
        set status = 'ready', result_media_id = $2, post_id = $3, model = $4, provider = $5,
            cost_cents = coalesce(cost_cents, $6), updated_at = now(), completed_at = now()
      where id = $1 and status = 'running'`,
    [jobId, mediaId, post?.id ?? null, route.model, route.provider, estCostCents()],
  );

  console.info(
    JSON.stringify({
      evt: "ai_video_cost",
      job_id: jobId,
      brand_id: brand.id,
      provider: route.provider,
      model: route.model,
      cost_cents: job.cost_cents || estCostCents(),
      status: "ready",
    }),
  );

  if (post) {
    await query(
      `insert into approval_log (post_id, brand_id, action, actor, after, note)
       values ($1, $2, 'draft_created', 'system', $3::jsonb, $4)`,
      [
        post.id,
        brand.id,
        JSON.stringify({ caption: aigcCaption, format: "reel", aigc: true }),
        "AI-generated Reel (AIGC) — pending approval",
      ],
    ).catch(() => {});
  }

  const when = post?.scheduled_at
    ? new Date(post.scheduled_at).toLocaleString("en-AU", {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : "soon";

  // MMS keeps the cover JPEG (carrier size limits); the mp4 goes in the body so
  // the client can actually watch what they are approving.
  const videoUrl = publicMediaUrl(mediaId);
  return {
    brandId: brand.id,
    sms: `Your AI Reel is ready (AIGC).\n\nWatch it: ${videoUrl}\n\n${aigcCaption}\n\nProposed for ${when}. Reply yes to send it as an organic Reel, or say if you want it as paid creative input.`,
    mediaUrl: coverId ? publicMediaUrl(coverId) : videoUrl,
    videoUrl,
  };
}

/** Drain up to `limit` queued AI video jobs (worker loop). */
export async function runAiVideoJobDrain(limit = 2): Promise<
  Array<{ brandId: string; sms: string; mediaUrl?: string; videoUrl?: string }>
> {
  const rows = await query<AiVideoJob>(
    `select * from ai_video_jobs where status = 'queued' order by created_at asc limit $1`,
    [limit],
  );
  const out: Array<{ brandId: string; sms: string; mediaUrl?: string; videoUrl?: string }> = [];
  for (const row of rows) {
    try {
      const res =
        row.kind === "ugc" ? await processUgcJob(row.id) : await processAiVideoJob(row.id);
      if (res) {
        console.info(
          JSON.stringify({
            evt: "ai_video_drain",
            job_id: row.id,
            brand_id: row.brand_id,
            cost_cents: row.cost_cents,
            status: "processed",
          }),
        );
        out.push(res);
      }
    } catch (err) {
      console.error(`runAiVideoJobDrain: job ${row.id}`, err);
      // Status-guarded: a job that already wrote itself 'ready' must not be
      // stomped back to 'failed' by a late error on the way out.
      await query(
        `update ai_video_jobs set status = 'failed', error = $2, updated_at = now(), completed_at = now()
          where id = $1 and status in ('queued','running')`,
        [row.id, err instanceof Error ? err.message : String(err)],
      ).catch(() => {});
    }
  }
  return out;
}

/**
 * Minutes a job may sit in 'running' before it is presumed dead.
 * Deliberately generous — a 3-scene UGC job legitimately runs for tens of
 * minutes (3 stills x up to 3 models, then 3 Kling renders, then ffmpeg).
 * Far longer than the kickoff queue's 12 min, which is a different workload.
 */
export function staleAiVideoMinutes(): number {
  const raw = process.env.AI_VIDEO_STALE_MINUTES;
  const n = raw != null && raw !== "" ? Number(raw) : 45;
  return Number.isFinite(n) && n > 0 ? n : 45;
}

/**
 * Fail jobs stuck in 'running'. Without this a hung provider read leaves the row
 * 'running' forever: no failure SMS, no retry, and it permanently consumes
 * monthly cap headroom (which counts 'running').
 *
 * The terminal write is status-guarded (`and status = 'running'`) and re-checks
 * updated_at, so a job that is genuinely still working — and wrote itself
 * 'ready' in the meantime — cannot be resurrected or stomped by the reaper.
 */
export async function reapStaleAiVideoJobs(
  limit = 5,
): Promise<Array<{ brandId: string; sms: string }>> {
  const minutes = staleAiVideoMinutes();
  const rows = await query<AiVideoJob & { kind?: string }>(
    `update ai_video_jobs
        set status = 'failed',
            error = 'stale: no provider result within ' || $1::text || ' minutes',
            updated_at = now(), completed_at = now()
      where id in (
        select id from ai_video_jobs
         where status = 'running'
           and updated_at < now() - ($1::text || ' minutes')::interval
         order by updated_at asc
         limit $2
      )
        and status = 'running'
      returning *`,
    [String(minutes), limit],
  );
  return rows.map((row) => ({
    brandId: row.brand_id,
    sms:
      row.kind === "ugc"
        ? "That UGC video stalled at the provider and I've stopped it there so it doesn't keep costing you. Want me to try again?"
        : "That AI video stalled at the provider and I've stopped it there so it doesn't keep costing you. Want me to try again?",
  }));
}

/** Test helper */
export function _resetAiVideoEnvCache(): void {
  resetServerEnvCache();
}
