import { after } from 'next/server';
import { drainVoiceAnalysisForBrand } from '@pulse/orchestrator';
import { sendToBrand } from '@pulse/gateway';

/**
 * Queue is enough when the Railway worker is healthy. Also schedule an
 * in-process drain via Next.js `after()` so post-harvest still completes if the
 * worker is down. Interview already starts on connect — this only runs analysis
 * (continueOnboardingAfterVoiceAnalysis is a no-op once status is in_progress).
 */
export function scheduleVoiceAnalysisDrain(brandId: string): void {
  after(async () => {
    try {
      const { analysed, opening } = await drainVoiceAnalysisForBrand(brandId);
      if (opening) {
        await sendToBrand(brandId, opening);
      }
      if (analysed || opening) {
        console.info('[voice] after() drain finished', { brandId, analysed, continued: Boolean(opening) });
      }
    } catch (err) {
      console.error(
        '[voice] after() drain failed',
        brandId,
        err instanceof Error ? err.message : err,
      );
    }
  });
}
