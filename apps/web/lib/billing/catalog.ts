import 'server-only';
import {
  stripePriceCatalogFromEnv,
  type StripePriceCatalog,
} from '@pulse/shared';

export function requireStripePriceCatalog(): StripePriceCatalog {
  const catalog = stripePriceCatalogFromEnv();
  if (!catalog) {
    throw new Error(
      'Stripe price IDs are not configured (STRIPE_PRICE_PRO_MONTH/YEAR, STRIPE_PRICE_MAX_MONTH/YEAR)',
    );
  }
  return catalog;
}
