'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { OperatorUser } from '@/lib/data/users';
import PasswordDeleteModal from './components/PasswordDeleteModal';

function label(u: OperatorUser): string {
  return u.name || u.email || u.phone || u.id.slice(0, 8);
}

function contactLine(u: OperatorUser): string {
  const email = u.email ?? 'no email';
  const phone = u.phone ?? 'no phone';
  const brand = u.brand_name
    ? `${u.brand_name}${u.brand_status ? ` · ${u.brand_status}` : ''}`
    : 'no brand';
  return `${email} · ${phone} · ${brand}`;
}

export default function OperatorUsers({
  users,
  currentUserId,
}: {
  users: OperatorUser[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingHard, setPendingHard] = useState<OperatorUser | null>(null);

  async function act(u: OperatorUser, kind: 'soft' | 'hard' | 'restore', password?: string) {
    setError(null);
    const name = label(u);

    if (kind === 'soft' && !confirm(`Deactivate ${name}? Their brands will be paused. You can restore them later.`)) {
      return;
    }

    setBusyId(u.id);
    try {
      const res =
        kind === 'restore'
          ? await fetch(`/api/operator/users/${u.id}`, { method: 'PATCH' })
          : await fetch(`/api/operator/users/${u.id}?mode=${kind}`, {
              method: 'DELETE',
              headers: kind === 'hard' ? { 'content-type': 'application/json' } : undefined,
              body: kind === 'hard' ? JSON.stringify({ password }) : undefined,
            });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? `Request failed (${res.status}).`);
        return;
      }
      setPendingHard(null);
      router.refresh();
    } catch {
      setError('Network error — please try again.');
    } finally {
      setBusyId(null);
    }
  }

  if (users.length === 0) return <p className="empty">No users yet.</p>;

  return (
    <div>
      {error && (
        <p className="empty" role="alert" style={{ color: '#c0392b', margin: '0 0 12px' }}>
          {error}
        </p>
      )}
      {users.map((u) => {
        const deactivated = Boolean(u.deleted_at);
        const isSelf = u.id === currentUserId;
        const busy = busyId === u.id;
        const profileHref = `/app/operator/users/${u.id}`;

        const info = (
          <>
            <strong>
              {label(u)}
              {u.is_admin && <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.7 }}>admin</span>}
              {isSelf && <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.7 }}>you</span>}
              {deactivated && (
                <span style={{ marginLeft: 8, fontSize: 12, color: '#c0392b' }}>deactivated</span>
              )}
            </strong>
            <p className="empty" style={{ margin: '4px 0 0' }}>
              {contactLine(u)}
            </p>
          </>
        );

        return (
          <div
            key={u.id}
            className="brand-card"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              opacity: deactivated ? 0.55 : 1,
            }}
          >
            <Link href={profileHref} style={{ minWidth: 0, flex: 1, textDecoration: 'none', color: 'inherit' }}>
              {info}
            </Link>

            {!isSelf && (
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                {deactivated ? (
                  <button type="button" className="pill-dark" disabled={busy} onClick={() => act(u, 'restore')}>
                    {busy ? '…' : 'Restore'}
                  </button>
                ) : (
                  <button type="button" className="pill-dark" disabled={busy} onClick={() => act(u, 'soft')}>
                    {busy ? '…' : 'Deactivate'}
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setPendingHard(u)}
                  style={{
                    border: '1px solid #c0392b',
                    color: '#c0392b',
                    background: 'transparent',
                    borderRadius: 999,
                    padding: '6px 14px',
                    cursor: busy ? 'default' : 'pointer',
                    fontSize: 14,
                  }}
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        );
      })}

      <PasswordDeleteModal
        open={Boolean(pendingHard)}
        title={pendingHard ? `Permanently delete ${label(pendingHard)}?` : ''}
        body="This erases their account and ALL their brands and data. This cannot be undone."
        confirmLabel="Delete forever"
        requirePassword
        busy={Boolean(pendingHard && busyId === pendingHard.id)}
        onCancel={() => setPendingHard(null)}
        onConfirm={(password) => {
          if (pendingHard) void act(pendingHard, 'hard', password);
        }}
      />
    </div>
  );
}
