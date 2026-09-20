/**
 * Blog ("Notes") content — single source of truth for the index, the post
 * pages, the sitemap and the Article JSON-LD. `blurb` is the one-line teaser on
 * the index; `paragraphs` is the full post body.
 */
export type BlogPost = {
  slug: string;
  title: string;
  date: string;
  /** ISO date for structured data / sitemap lastmod. */
  isoDate: string;
  blurb: string;
  paragraphs: string[];
};

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: 'text-a-photo',
    title: 'Why Kip starts with a text thread',
    date: 'Sep 2026',
    isoDate: '2026-09-01',
    blurb: 'Dashboards are where posts go to die. The floor of a shop already has a phone in it.',
    paragraphs: [
      'Most social tools ask you to open a dashboard, drag assets into a calendar, and remember to come back. Shop owners don’t forget social because they’re lazy — they forget because the work is on the floor, and the phone is already in their pocket.',
      'Kip lives in that pocket. You text a photo. Kip writes the caption in your voice. You say yes. It posts. The loop is short enough to finish between customers.',
      'Dashboards still exist if you want them. The point is you shouldn’t need one to stay consistent.',
    ],
  },
  {
    slug: 'organic-only',
    title: 'Organic only — on purpose',
    date: 'Sep 2026',
    isoDate: '2026-09-08',
    blurb: 'Paid ads can wait. Showing up every week in your own voice usually can’t.',
    paragraphs: [
      'Paid ads are a different sport: budgets, creative tests, attribution arguments. Useful later. Not the first problem for a bakery that hasn’t posted in three weeks.',
      'Kip stays in organic — Instagram, Facebook, X, Threads — so the product stays sharp. Captions, calendar, nudges, recaps, autopilot when you want evenings back.',
      'If you need media buying, hire for that. Kip’s job is showing up every week without sounding like a robot or a retainer.',
    ],
  },
  {
    slug: 'vs-hiring',
    title: 'Kip vs hiring a social media manager',
    date: 'Sep 2026',
    isoDate: '2026-09-15',
    blurb: 'Same job on captions and calendar. Different invoice — and no awkward stand-up.',
    paragraphs: [
      'A good social media manager is worth real money: voice, calendar, approvals, the weekly rhythm. They also cost $2,000–$5,000 a month, keep office hours, and often want decks.',
      'Kip covers the organic half of that job from $79 a month — captions, channels, calendar, yes-before-post. You send the photos. No on-site shoots. No paid ads. No stand-ups.',
      'If you need custom creative production and strategy workshops, hire a human. If you need the posting job done without another salary, text Kip.',
    ],
  },
];

export const BLOG_POSTS_BY_SLUG: Record<string, BlogPost> = Object.fromEntries(
  BLOG_POSTS.map((p) => [p.slug, p]),
);
