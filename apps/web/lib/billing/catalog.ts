import 'server-only';
import {
  stripePriceCatalogFromEnv,
  STRIPE_LOOKUP_KEYS,
  type StripePriceCatalog,
} from '@pulse/shared';
import { getStripe } from '@/lib/stripe';

const PRICE_SLOTS = ['pro_month', 'pro_year', 'max_month', 'max_year'] as const;

let cached: { catalog: StripePriceCatalog; at: number } | null = null;
const CACHE_MS = 5 * 60 * 1000;

/**
 * Resolve Checkout price IDs. Prefers STRIPE_PRICE_* env pins; otherwise
 * loads active Prices by lookup key (kip_pro_month / …) from the Stripe
 * account that owns STRIPE_SECRET_KEY.
 */
export async function loadStripePriceCatalog(): Promise<StripePriceCatalog> {
  const fromEnv = stripePriceCatalogFromEnv();
  if (fromEnv) return fromEnv;
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.catalog;

  const stripe = getStripe();
  const listed = await stripe.prices.list({
    lookup_keys: PRICE_SLOTS.map((slot) => STRIPE_LOOKUP_KEYS[slot]),
    active: true,
    limit: 10,
  });

  const byKey = new Map<string, string>();
  for (const price of listed.data) {
    if (price.lookup_key) byKey.set(price.lookup_key, price.id);
  }

  const catalog: StripePriceCatalog = {
    pro_month: byKey.get(STRIPE_LOOKUP_KEYS.pro_month) ?? '',
    pro_year: byKey.get(STRIPE_LOOKUP_KEYS.pro_year) ?? '',
    max_month: byKey.get(STRIPE_LOOKUP_KEYS.max_month) ?? '',
    max_year: byKey.get(STRIPE_LOOKUP_KEYS.max_year) ?? '',
  };
  const missing = PRICE_SLOTS.filter((slot) => !catalog[slot]).map(
    (slot) => STRIPE_LOOKUP_KEYS[slot],
  );
  if (missing.length) {
    throw new Error(`Stripe prices missing lookup keys: ${missing.join(', ')}`);
  }

  cached = { catalog, at: Date.now() };
  return catalog;
}

export async function loadStripePriceCatalogOrNull(): Promise<StripePriceCatalog | null> {
  try {
    return await loadStripePriceCatalog();
  } catch (err) {
    console.warn('[billing] price catalog unavailable', err instanceof Error ? err.message : err);
    return null;
  }
}
