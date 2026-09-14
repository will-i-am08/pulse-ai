import { after } from 'next/server';
import { runKickoffDrain } from '@pulse/orchestrator';
import { sendToBrand } from '@pulse/gateway';

/**
 * Railway worker drains kip_kickoffs on a 30s tick — but if the worker is
 * behind/redeploying, queued jobs sit forever. Mirror the voice-analysis
 * pattern: schedule an in-process drain via Next.js `after()` so the Twilio
 * webhook can return fast while drafts still get built + SMS'd.
 *
 * Do NOT also fire-and-forget drain inside the gateway request: that claims
 * kickoffs then dies when the isolate freezes after 204, leaving `running`
 * zombies. `runKickoffDrain` reclaims stale running rows before claiming.
 *
 * Drafts SMS as each finishes (not after the whole batch).
 */
export function scheduleKickoffDrain(reason = 'inbound'): void {
  after(async () => {
    try {
      const results = await runKickoffDrain(2, {
        deliver: async (r) => {
          await sendToBrand(r.brandId, r.sms, r.mediaUrl ? [r.mediaUrl] : undefined);
        },
      });
      if (results.length) {
        console.info('[kickoffs] after() drain finished', {
          reason,
          count: results.length,
          brandIds: [...new Set(results.map((r) => r.brandId))],
        });
      }
    } catch (err) {
      console.error(
        '[kickoffs] after() drain failed',
        reason,
        err instanceof Error ? err.message : err,
      );
    }
  });
}
