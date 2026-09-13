import { after } from 'next/server';
import { runKickoffDrain } from '@pulse/orchestrator';
import { sendToBrand } from '@pulse/gateway';

/**
 * Railway worker drains kip_kickoffs on a 30s tick — but if the worker is
 * behind/redeploying, queued jobs sit forever. Mirror the voice-analysis
 * pattern: also schedule an in-process drain via Next.js `after()` so the
 * Twilio webhook can return fast while drafts still get built + SMS'd.
 */
export function scheduleKickoffDrain(reason = 'inbound'): void {
  after(async () => {
    try {
      const results = await runKickoffDrain(2);
      for (const r of results) {
        await sendToBrand(r.brandId, r.sms, r.mediaUrl ? [r.mediaUrl] : undefined);
      }
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
