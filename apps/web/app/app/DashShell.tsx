'use client';
import { useState, type ReactNode } from 'react';
import Link, { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';
import { signOutAction } from '@/lib/actions/auth';

type NavItem = { href: string; label: string; match: (p: string) => boolean };

function NavPending() {
  const { pending } = useLinkStatus();
  return pending ? <span className="nav-spin" aria-hidden="true" /> : null;
}

const USER_NAV: NavItem[] = [
  { href: '/app', label: 'Thread', match: (p) => p === '/app' },
  { href: '/app/approvals', label: 'Approvals', match: (p) => p.startsWith('/app/approvals') },
  { href: '/app/plan', label: 'Calendar', match: (p) => p.startsWith('/app/plan') },
  { href: '/app/routines', label: 'Routines', match: (p) => p.startsWith('/app/routines') },
  { href: '/app/memory', label: 'Memory', match: (p) => p.startsWith('/app/memory') },
  { href: '/app/connections', label: 'Connections', match: (p) => p.startsWith('/app/connections') },
  { href: '/app/content-plan', label: 'Plan', match: (p) => p.startsWith('/app/content-plan') },
];

const ADMIN_NAV: NavItem[] = [
  { href: '/app/operator', label: 'Overview', match: (p) => p === '/app/operator' },
  { href: '/app/operator/users', label: 'Users', match: (p) => p.startsWith('/app/operator/users') },
  { href: '/lab', label: 'Lab', match: (p) => p === '/lab' || p.startsWith('/lab/') },
];

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export function DashShell({ children, isAdmin }: { children: ReactNode; isAdmin: boolean }) {
  const pathname = usePathname() || '/app';
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const items = isAdmin ? ADMIN_NAV : USER_NAV;
  const homeHref = isAdmin ? '/app/operator' : '/app';

  return (
    <div className={`desk${open ? ' menu-open' : ''}`}>
      <header className="topbar">
        <button className="menu-btn" type="button" aria-label="Open menu" aria-controls="app-menu" onClick={() => setOpen(true)}>
          <MenuIcon />
        </button>
        <Link className="brand" href={homeHref} onClick={close}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/kip-cat.png" width={28} height={28} alt="" />
          <span>Kip</span>
        </Link>
        <form action={signOutAction}>
          <button className="ghost" type="submit">
            Sign out
          </button>
        </form>
      </header>

      <button className="scrim" type="button" aria-label="Close menu" onClick={close} />

      <aside className="rail" id="app-menu" aria-label="Menu">
        <Link className="brand" href={homeHref} onClick={close}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/kip-cat.png" width={28} height={28} alt="" />
          <span>Kip</span>
        </Link>
        <nav className="rail-nav">
          {items.map((item) => (
            <Link key={item.href} href={item.href} className={item.match(pathname) ? 'on' : ''} onClick={close}>
              {item.label}
              <NavPending />
            </Link>
          ))}
        </nav>
        <form className="rail-foot" action={signOutAction}>
          <button className="navb" type="submit">
            Sign out
          </button>
        </form>
      </aside>

      {children}
    </div>
  );
}
