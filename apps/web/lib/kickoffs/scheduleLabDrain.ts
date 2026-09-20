import { after } from "next/server";
import { runKickoffDrain, requeueStaleKickoffs } from "@pulse/orchestrator";
import { sendToBrand } from "@pulse/gateway";
import type { LabChannel } from "@pulse/channel-lab";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Lab inbound never hits the Twilio webhook, so `scheduleKickoffDrain('twilio')`
 * never runs. Drain THIS lab brand only, and deliver through the lab channel
 * (never Twilio). `runKickoffDrain` without `brandId` would claim real brands
 * and the lab channel would log their drafts into the wrong thread.
 *
 * Photo carousels regularly exceed the 300s after() budget. A delayed
 * continuation fetch starts a *fresh* isolate (own 300s) after the primary
 * may have been killed; that isolate requeues abandoned running rows and
 * drains again.
 */
export function scheduleLabKickoffDrain(
  brandId: string,
  channel: LabChannel,
  reason = "lab",
  opts?: { cookieHeader?: string },
): void {
  const deliver = async (r: {
    brandId: string;
    sms: string;
    mediaUrl?: string;
    mediaUrls?: string[];
  }) => {
    if (r.brandId !== brandId) {
      console.error("[kickoffs] lab drain refused foreign brand", {
        expected: brandId,
        got: r.brandId,
      });
      return;
    }
    await sendToBrand(
      r.brandId,
      r.sms,
      r.mediaUrls?.length ? r.mediaUrls : r.mediaUrl ? [r.mediaUrl] : undefined,
      { pace: false, channel },
    );
  };

  after(async () => {
    try {
      const results = await runKickoffDrain(2, { brandId, deliver });
      if (results.length) {
        console.info("[kickoffs] lab after() drain finished", {
          reason,
          brandId,
          count: results.length,
        });
      }
    } catch (err) {
      console.error(
        "[kickoffs] lab after() drain failed",
        reason,
        err instanceof Error ? err.message : err,
      );
    }
  });

  // Delayed continuation in a NEW isolate. Wait until the primary is near its
  // 300s kill so the continuation's own 300s budget extends past that death.
  // Dispatch-only — do not await the remote drain.
  after(async () => {
    try {
      await sleep(250_000);
      const base =
        process.env.APP_BASE_URL?.replace(/\/$/, "") ||
        process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
        "";
      if (!base) {
        console.warn("[kickoffs] lab continuation skipped — no APP_BASE_URL");
        return;
      }
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "x-lab-kickoff-continue": "1",
      };
      if (opts?.cookieHeader) headers.Cookie = opts.cookieHeader;
      // Fire-and-forget: remote isolate keeps running after we stop awaiting.
      void fetch(`${base}/api/lab/kickoffs/drain`, {
        method: "POST",
        headers,
        body: JSON.stringify({ brandId }),
      }).catch((err) =>
        console.error(
          "[kickoffs] lab continuation fetch failed",
          err instanceof Error ? err.message : err,
        ),
      );
      // Brief linger so the request is accepted before this after() ends.
      await sleep(3_000);
      console.info("[kickoffs] lab continuation dispatched", { brandId });
    } catch (err) {
      console.error(
        "[kickoffs] lab continuation schedule failed",
        err instanceof Error ? err.message : err,
      );
    }
  });
}

/** Used by the continuation route — requeue abandoned work then drain. */
export async function runLabKickoffContinuation(
  brandId: string,
  channel: LabChannel,
): Promise<{ requeued: number; drained: number }> {
  const deliver = async (r: {
    brandId: string;
    sms: string;
    mediaUrl?: string;
    mediaUrls?: string[];
  }) => {
    if (r.brandId !== brandId) return;
    await sendToBrand(
      r.brandId,
      r.sms,
      r.mediaUrls?.length ? r.mediaUrls : r.mediaUrl ? [r.mediaUrl] : undefined,
      { pace: false, channel },
    );
  };

  const { query } = await import("@pulse/shared");
  const t0 = Date.now();
  let requeued = 0;
  let drained = 0;
  // Poll until near our own 300s wall — primary may still be alive at start.
  while (Date.now() - t0 < 270_000) {
    // Primary heartbeats every 10s; once killed, updated_at freezes.
    const ids = await requeueStaleKickoffs({ brandId, staleMs: 45_000 });
    requeued += ids.length;
    const results = await runKickoffDrain(2, { brandId, deliver });
    drained += results.length;
    if (results.length) break;
    const active = await query<{ n: string }>(
      `select count(*)::text as n from kip_kickoffs
        where brand_id = $1 and status in ('queued', 'running')`,
      [brandId],
    );
    if (Number(active[0]?.n ?? 0) === 0) break;
    await sleep(15_000);
  }
  return { requeued, drained };
}
