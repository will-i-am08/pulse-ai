import { query, type Brand } from "@pulse/shared";
import { listVisualExemplars, storeVisualExemplars } from "./research.js";

/**
 * Cold-start bootstrap: when design memory is empty and visual_exemplars has
 * fewer than 3 rows, seed niche placeholder exemplar URLs (public, SSRF-safe)
 * so the design composer has category anchors on first compose.
 *
 * Prefer real URLs from research (`runDeepResearch` / competitor watch). This
 * only fills the gap when research hasn't landed yet.
 */
const NICHE_BOOTSTRAP: Array<{ url: string; label: string; notes: string }> = [
  {
    url: "https://www.instagram.com/explore/tags/smallbusiness/",
    label: "Niche feed patterns",
    notes: "Category composition reference — not a clone target",
  },
  {
    url: "https://www.instagram.com/explore/tags/localbusiness/",
    label: "Local brand layouts",
    notes: "Warm, product-forward framing common in local niches",
  },
  {
    url: "https://www.facebook.com/ads/library/",
    label: "Ad Library creative patterns",
    notes: "Public Meta Ad Library — hooks and visual hierarchy only",
  },
];

/** Ensure ≥3 niche exemplars exist for cold-start design. Idempotent. */
export async function ensureNicheExemplarBootstrap(brand: Brand): Promise<number> {
  let existing: Awaited<ReturnType<typeof listVisualExemplars>> = [];
  try {
    existing = await listVisualExemplars(brand.id, 8);
  } catch {
    // Table may not exist yet on a lagging migrate — skip quietly.
    return 0;
  }
  if (existing.length >= 3) return 0;

  const need = 3 - existing.length;
  const toAdd = NICHE_BOOTSTRAP.slice(0, need).map((e) => ({
    url: e.url,
    source: "niche" as const,
    label: e.label,
    notes: e.notes,
  }));
  try {
    return await storeVisualExemplars(brand.id, toAdd);
  } catch (err) {
    console.error(`ensureNicheExemplarBootstrap: failed for brand ${brand.id}`, err);
    return 0;
  }
}

/** After onboarding niche capture — best-effort seed if research hasn't run yet. */
export async function seedOnboardingNicheExemplars(brandId: string): Promise<void> {
  const brand = { id: brandId } as Brand;
  await ensureNicheExemplarBootstrap(brand);
}

/** Count exemplars (for tests / ops). */
export async function countVisualExemplars(brandId: string): Promise<number> {
  try {
    const rows = await query<{ n: string }>(
      `select count(*)::text as n from visual_exemplars where brand_id = $1`,
      [brandId],
    );
    return Number(rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}
