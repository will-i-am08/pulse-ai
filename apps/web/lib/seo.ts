/**
 * Central SEO/GEO config for the marketing surface (landing, blog, legal).
 *
 * One source of truth for the canonical origin, brand facts, and the JSON-LD
 * builders. Everything drives off APP_BASE_URL so a future custom domain only
 * needs the env var flipped — no code change. GEO note: the JSON-LD below is
 * what AI answer engines (ChatGPT, Perplexity, Google AI Overviews, Claude)
 * read to cite Kip accurately, so keep the facts here in sync with the page copy.
 */

/** Canonical origin, no trailing slash. Falls back to the live Vercel URL. */
export const SITE_URL = (
  process.env.APP_BASE_URL ?? 'https://web-tau-three-59.vercel.app'
).replace(/\/$/, '');

export const SITE_NAME = 'Kip';
export const LEGAL_NAME = 'Pulse Social Media';
export const CONTACT_EMAIL = 'will@jmcalder.com';

export const SITE_TAGLINE = 'Text a photo. It’s posted.';
export const SITE_DESCRIPTION =
  'Kip runs your organic social. Text a photo, it writes the caption in your voice, you say yes, and it posts to Instagram, Facebook, X and Threads. Nothing posts without your yes.';

export const CHANNELS = ['Instagram', 'Facebook', 'X', 'Threads'] as const;

/** Build an absolute URL from a site-relative path. */
export function absoluteUrl(path = '/'): string {
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Organization entity — reused site-wide so engines resolve a single brand. */
export function organizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: SITE_NAME,
    legalName: LEGAL_NAME,
    url: SITE_URL,
    email: CONTACT_EMAIL,
    logo: {
      '@type': 'ImageObject',
      url: absoluteUrl('/brand/kip-logo-1024.png'),
      width: 1024,
      height: 1024,
    },
    description: SITE_DESCRIPTION,
    slogan: SITE_TAGLINE,
    contactPoint: {
      '@type': 'ContactPoint',
      email: CONTACT_EMAIL,
      contactType: 'customer support',
      availableLanguage: 'English',
    },
  };
}

/** WebSite entity — anchors the domain and enables sitelinks in results. */
export function websiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    publisher: { '@id': `${SITE_URL}/#organization` },
    inLanguage: 'en',
  };
}

/**
 * SoftwareApplication entity for the product itself — the core GEO signal.
 * Prices mirror the pricing section; keep them honest for AI citations.
 */
export function softwareApplicationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    '@id': `${SITE_URL}/#software`,
    name: SITE_NAME,
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'Social Media Management',
    operatingSystem: 'Web, SMS',
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    publisher: { '@id': `${SITE_URL}/#organization` },
    featureList: [
      'Writes captions in your brand voice',
      'Approve every post by text before it goes live',
      'Posts organic to Instagram, Facebook, X and Threads',
      'Weekly check-ins, Friday recaps and quiet reminders',
      'Optional autopilot',
      'Optional paid ads and boosts on the Max plan, on your own ad account',
      'Encrypted by default; never used to train models',
    ],
    offers: [
      {
        '@type': 'Offer',
        name: 'Kip monthly',
        price: '79',
        priceCurrency: 'USD',
        description: 'Organic social posting, captions and approvals from $79/month.',
        url: absoluteUrl('/#pricing'),
        availability: 'https://schema.org/InStock',
      },
    ],
  };
}

/** FAQPage entity built from the shared FAQ source. */
export function faqSchema(faqs: { q: string; a: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${SITE_URL}/#faq`,
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

/** BreadcrumbList — helps engines place a page in the site hierarchy. */
export function breadcrumbSchema(items: { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

/** Article entity for blog posts. */
export function articleSchema(post: {
  title: string;
  description: string;
  path: string;
  datePublished?: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.description,
    url: absoluteUrl(post.path),
    ...(post.datePublished ? { datePublished: post.datePublished } : {}),
    author: { '@id': `${SITE_URL}/#organization` },
    publisher: { '@id': `${SITE_URL}/#organization` },
    mainEntityOfPage: absoluteUrl(post.path),
    image: absoluteUrl('/opengraph-image'),
  };
}

/** Serialize schema object(s) for a <script type="application/ld+json"> tag. */
export function jsonLd(schema: object | object[]): string {
  return JSON.stringify(schema);
}
