import { after } from "next/server";
import { runKickoffDrain } from "@pulse/orchestrator";
import { sendToBrand } from "@pulse/gateway";
import type { LabChannel } from "@pulse/channel-lab";

/**
 * Lab inbound never hits the Twilio webhook, so `scheduleKickoffDrain('twilio')`
 * never runs. Drain THIS lab brand only, and deliver through the lab channel
 * (never Twilio). `runKickoffDrain` without `brandId` would claim real brands
 * and the lab channel would log their drafts into the wrong thread.
 */
export function scheduleLabKickoffDrain(
  brandId: string,
  channel: LabChannel,
  reason = "lab",
): void {
  after(async () => {
    try {
      const results = await runKickoffDrain(2, {
        brandId,
        deliver: async (r) => {
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
        },
      });
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
}
