/**
 * Landing FAQ — single source of truth shared by the interactive accordion
 * (LandingFaq.tsx) and the FAQPage JSON-LD on the landing page. Keeping one
 * list means the copy people read and the copy AI engines cite never drift.
 */
export type Faq = { q: string; a: string };

export const LANDING_FAQS: Faq[] = [
  {
    q: 'Does anything post without my yes?',
    a: 'No — unless you turn on Autopilot on Max. Default Kip drafts in the thread and waits for your yes. You stay in control.',
  },
  {
    q: 'Which platforms does Kip post to?',
    a: 'Instagram, Facebook, X, and Threads for organic posting. Paid ads are optional on Max, using your own ad account — Kip does not run media buying on Pro.',
  },
  {
    q: 'Will the captions sound like me?',
    a: 'Kip learns your voice from what you send and from memory you can edit. Warm, short, on-brand — not generic AI filler.',
  },
  {
    q: 'How fast can I get going?',
    a: 'Connect your channels, text a photo, approve the draft. Most people are live the same day — often in about ten minutes.',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes. Monthly plans cancel anytime. Annual is billed up front; message us if you need help winding down.',
  },
  {
    q: 'What if the first week isn’t useful?',
    a: 'Email will@jmcalder.com within seven days of your first charge. If Kip isn’t earning its keep, we’ll refund that week.',
  },
  {
    q: 'What happens to my photos and data?',
    a: 'Encrypted in transit and at rest. Never sold, never used to train models. Disconnect channels anytime, or email us to wipe what we hold.',
  },
  {
    q: 'Is Kip a full social media manager?',
    a: 'Kip runs organic posting, captions, calendar, nudges, and recaps. Paid ads are an optional Max add-on on your ad account. It doesn’t do on-site shoots or strategy decks. You send the photos.',
  },
];
