'use client';

import { useState } from 'react';
import { LANDING_FAQS as FAQS } from '../../lib/faq';
import styles from '../page.module.css';

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
