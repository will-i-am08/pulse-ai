'use client';

import { useState } from 'react';
import styles from '../page.module.css';

const FAQS: { q: string; a: string }[] = [
  {
    q: 'Does anything post without my yes?',
    a: 'No — unless you turn on Autopilot on Max. Default Kip drafts in the thread and waits for your yes. You stay in control.',
  },
  {
    q: 'Which platforms does Kip post to?',
    a: 'Instagram, Facebook, X, and Threads. Organic only. No paid ads, no media buying.',
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
    a: 'Kip runs organic posting, captions, calendar, nudges, and recaps. It doesn’t do on-site shoots, paid ads, or strategy decks. You send the photos.',
  },
];

export function LandingFaq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className={styles.faqList}>
      {FAQS.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={item.q} className={`${styles.faqItem} ${isOpen ? styles.faqOpen : ''}`}>
            <button
              type="button"
              className={styles.faqQ}
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : i)}
            >
              <span>{item.q}</span>
              <span className={styles.faqIcon} aria-hidden="true">
                {isOpen ? '−' : '+'}
              </span>
            </button>
            <div className={styles.faqA} hidden={!isOpen}>
              <p>{item.a}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
