'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Brand } from '@pulse/shared';
import PasswordDeleteModal from './components/PasswordDeleteModal';

function isConnected(b: Brand): boolean {
  return Boolean(b.fb_page_id && b.platform_tokens_encrypted && b.ig_user_id);
}

function brandLine(b: Brand): string {
  const handle = b.ig_username
    ? `@${b.ig_username}`
    : isConnected(b)
      ? b.fb_page_name ?? 'connected'
      : 'Not connected';
  const setup = b.onboarding_state?.status ?? 'none';
  return `${handle} · setup ${setup} · ${b.status}`;
}

export default function OperatorUnownedBrands({ brands }: { brands: Brand[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Brand | null>(null);

  async function remove(b: Brand, password: string) {
    setError(null);
    setBusyId(b.id);
    try {
      const res = await fetch(`/api/operator/brands/${b.id}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? `Request failed (${res.status}).`);
        return;
      }
      setPending(null);
      router.refresh();
    } catch {
      setError('Network error — please try again.');
    } finally {
      setBusyId(null);
    }
  }

  if (brands.length === 0) return null;

  return (
    <div>
      {error && (
        <p className="empty" role="alert" style={{ color: '#c0392b', margin: '0 0 12px' }}>
          {error}
        </p>
      )}
      {brands.map((b) => {
        const busy = busyId === b.id;
        return (
          <div
            key={b.id}
            className="brand-card"
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
          >
            <Link
              href={`/app/brands/${b.id}`}
              style={{ minWidth: 0, flex: 1, textDecoration: 'none', color: 'inherit' }}
            >
              <strong>{b.name}</strong>
              <p className="empty" style={{ margin: '4px 0 0' }}>
                {brandLine(b)}
              </p>
            </Link>
            <button
              type="button"
              disabled={busy}
              onClick={() => setPending(b)}
              style={{
                border: '1px solid #c0392b',
                color: '#c0392b',
                background: 'transparent',
                borderRadius: 999,
                padding: '6px 14px',
                cursor: busy ? 'default' : 'pointer',
                fontSize: 14,
                flexShrink: 0,
              }}
            >
              {busy ? '…' : 'Delete'}
            </button>
          </div>
        );
      })}

      <PasswordDeleteModal
        open={Boolean(pending)}
        title={pending ? `Permanently delete ${pending.name}?` : ''}
        body="This erases the brand and all its data. This cannot be undone."
        confirmLabel="Delete forever"
        requirePassword
        busy={Boolean(pending && busyId === pending.id)}
        onCancel={() => setPending(null)}
        onConfirm={(password) => {
          if (pending) void remove(pending, password);
        }}
      />
    </div>
  );
}
