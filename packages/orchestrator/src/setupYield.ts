/**
 * Onboarding is setup, not a status that cannot see a photo or a real brief.
 * Contact card / Meta connect still happen — but a photo or "just draft this"
 * falls through to the inbound brain, then Kip comes back to setup next turn.
 */
import { looksLikeMakeReelRequest } from "./aiVideo.js";
import { DRAFT_FILLER_RE } from "./draftAsk.js";
import { looksLikeKickoffRequest } from "./kickoffs.js";

export function setupYieldsToWork(
  body: string | null | undefined,
  mediaCount: number,
): boolean {
  if (mediaCount > 0) return true;
  const t = (body ?? "").trim();
  if (!t) return false;
  return (
    looksLikeKickoffRequest(t) ||
    DRAFT_FILLER_RE.test(t) ||
    looksLikeMakeReelRequest(t)
  );
}
