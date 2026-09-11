'use client';
import { useEffect } from 'react';

type Props = {
  navId: string;
  navSolidClass: string;
  revealClass: string;
  revealInClass: string;
};

/** Landing-page scroll behaviour: solidify the nav past the hero and
 *  reveal sections as they scroll into view. Renders nothing. */
export function LandingEffects({ navId, navSolidClass, revealClass, revealInClass }: Props) {
  useEffect(() => {
    const nav = document.getElementById(navId);
    const hero = document.querySelector<HTMLElement>('[data-hero]');

    let onScroll: (() => void) | null = null;
    if (nav && hero) {
      const sync = () => {
        const past = window.scrollY > Math.max(40, hero.offsetHeight * 0.55);
        nav.classList.toggle(navSolidClass, past);
      };
      sync();
      onScroll = sync;
      window.addEventListener('scroll', sync, { passive: true });
    }

    const nodes = Array.from(document.querySelectorAll<HTMLElement>(`.${revealClass}`));
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let io: IntersectionObserver | null = null;

    if (nodes.length) {
      if (reduce || !('IntersectionObserver' in window)) {
        nodes.forEach((el) => el.classList.add(revealInClass));
      } else {
        io = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (!entry.isIntersecting) return;
              entry.target.classList.add(revealInClass);
              io?.unobserve(entry.target);
            });
          },
          { threshold: 0.14, rootMargin: '0px 0px -6% 0px' },
        );
        nodes.forEach((el) => io!.observe(el));
      }
    }

    return () => {
      if (onScroll) window.removeEventListener('scroll', onScroll);
      io?.disconnect();
    };
  }, [navId, navSolidClass, revealClass, revealInClass]);

  return null;
}
