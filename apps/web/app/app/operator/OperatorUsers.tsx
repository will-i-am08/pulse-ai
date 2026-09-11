'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { OperatorUser } from '@/lib/data/users';

function label(u: OperatorUser): string {
  return u.name || u.email || u.phone || u.id.slice(0, 8);
}

export default function OperatorUsers({ users, currentUserId }: { users: OperatorUser[]; currentUserId: string }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(u: OperatorUser, kind: 'soft' | 'hard' | 'restore') {
    setError(null);
    const name = label(u);

    if (kind === 'soft' && !confirm(`Deactivate ${name}? Their brands will be paused. You can restore them later.`)) return;
    if (kind === 'hard' && !confirm(`Permanently delete ${name}? This erases their account and ALL their brands and data. This cannot be undone.`)) return;

    setBusyId(u.id);
    try {
      const res =
        kind === 'restore'
          ? await fetch(`/api/operator/users/${u.id}`, { method: 'PATCH' })
          : await fetch(`/api/operator/users/${u.id}?mode=${kind}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? `Request failed (${res.status}).`);
        return;
      }
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
        return (
          <div
            key={u.id}
            className="brand-card"
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, opacity: deactivated ? 0.55 : 1 }}
          >
            <div style={{ minWidth: 0 }}>
              <strong>
                {label(u)}
                {u.is_admin && <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.7 }}>admin</span>}
                {isSelf && <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.7 }}>you</span>}
                {deactivated && <span style={{ marginLeft: 8, fontSize: 12, color: '#c0392b' }}>deactivated</span>}
              </strong>
              <p className="empty" style={{ margin: '4px 0 0' }}>
                {u.email ?? 'no email'} · {u.brand_count} {u.brand_count === 1 ? 'brand' : 'brands'}
              </p>
            </div>

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
                  onClick={() => act(u, 'hard')}
                  style={{ border: '1px solid #c0392b', color: '#c0392b', background: 'transparent', borderRadius: 999, padding: '6px 14px', cursor: busy ? 'default' : 'pointer', fontSize: 14 }}
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
