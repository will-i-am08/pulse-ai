'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { OperatorUser } from '@/lib/data/users';
import PasswordDeleteModal from '../../components/PasswordDeleteModal';

function labelOf(u: OperatorUser): string {
  return u.name || u.email || u.phone || u.id.slice(0, 8);
}

function remainingLabel(expiresAt: string | null): string {
  if (!expiresAt) return '';
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const mins = Math.max(1, Math.round(ms / 60_000));
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
}

export default function OperatorUserProfile({
  user,
  currentUserId,
  initialUnlocked,
  initialExpiresAt,
}: {
  user: OperatorUser;
  currentUserId: string;
  initialUnlocked: boolean;
  initialExpiresAt: string | null;
}) {
  const router = useRouter();
  const isSelf = user.id === currentUserId;
  const [unlocked, setUnlocked] = useState(initialUnlocked);
  const [expiresAt, setExpiresAt] = useState<string | null>(initialExpiresAt);
  const [code, setCode] = useState('');
  const [name, setName] = useState(user.name ?? '');
  const [email, setEmail] = useState(user.email ?? '');
  const [phone, setPhone] = useState(user.phone ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteKind, setDeleteKind] = useState<'soft' | 'hard' | null>(null);

  useEffect(() => {
    if (!unlocked || !expiresAt) return;
    const id = window.setInterval(() => {
      if (new Date(expiresAt).getTime() <= Date.now()) {
        setUnlocked(false);
        setExpiresAt(null);
      }
    }, 15_000);
    return () => window.clearInterval(id);
  }, [unlocked, expiresAt]);

  async function post(body: Record<string, unknown>) {
    const res = await fetch(`/api/operator/users/${user.id}/unlock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      message?: string;
      expiresAt?: string;
    };
    if (!res.ok) throw new Error(data.message ?? `Request failed (${res.status})`);
    return data;
  }

  async function requestCode() {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      await post({ action: 'request' });
      setMessage('Unlock code sent to their phone.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send code.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const data = await post({ action: 'verify', code });
      setUnlocked(true);
      setExpiresAt(data.expiresAt ?? null);
      setCode('');
      setMessage('Private fields unlocked for 1 hour.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed.');
    } finally {
      setBusy(false);
    }
  }

  async function lockNow() {
    setBusy(true);
    setError(null);
    try {
      await post({ action: 'lock' });
      setUnlocked(false);
      setExpiresAt(null);
      setMessage('Locked again.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not lock.');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      await post({
        action: 'save',
        name: name.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
      });
      setMessage('Saved.');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  }

  async function runDelete(password: string) {
    if (!deleteKind) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/operator/users/${user.id}?mode=${deleteKind}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(deleteKind === 'hard' ? { password } : {}),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        setError(data.message ?? `Request failed (${res.status})`);
        return;
      }
      setDeleteKind(null);
      if (deleteKind === 'hard') router.push('/app/operator/users');
      else router.refresh();
    } catch {
      setError('Network error — please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/operator/users/${user.id}`, { method: 'PATCH' });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        setError(data.message ?? `Request failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      setError('Network error — please try again.');
    } finally {
      setBusy(false);
    }
  }

  const deactivated = Boolean(user.deleted_at);

  return (
    <div>
      <p style={{ margin: '0 0 16px' }}>
        <Link href="/app/operator/users" style={{ color: 'inherit' }}>
          ← Users
        </Link>
      </p>

      <h1 className="page-h1">{labelOf(user)}</h1>
      <p className="lead">
        {user.is_admin ? 'Admin · ' : ''}
        Joined {new Date(user.created_at).toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })}
        {deactivated ? ' · deactivated' : ''}
      </p>

      <div className="brand-card" style={{ marginTop: 16 }}>
        <strong>Brand</strong>
        <p className="empty" style={{ margin: '4px 0 0' }}>
          {user.brand_name
            ? `${user.brand_name}${user.brand_status ? ` · ${user.brand_status}` : ''}`
            : 'No brand attached'}
        </p>
        {user.brand_id && (
          <p style={{ margin: '8px 0 0' }}>
            <Link href={`/app/brands/${user.brand_id}`}>Open brand tools</Link>
          </p>
        )}
      </div>

      <h2 className="page-h1" style={{ marginTop: 32, fontSize: 22 }}>
        Private details
      </h2>
      <p className="lead">
        {unlocked
          ? `Unlocked for ${remainingLabel(expiresAt)}. Changes require this window.`
          : 'Locked. Request a code to their phone, then enter it to edit for 1 hour.'}
      </p>

      {error && (
        <p className="empty" role="alert" style={{ color: '#c0392b' }}>
          {error}
        </p>
      )}
      {message && <p className="empty">{message}</p>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        {!unlocked ? (
          <>
            <button type="button" className="pill-dark" disabled={busy} onClick={requestCode}>
              {busy ? '…' : 'Request unlock code'}
            </button>
            <input
              type="text"
              inputMode="numeric"
              placeholder="6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={busy}
              style={{ padding: '6px 10px', fontSize: 14, borderRadius: 8, border: '1px solid rgba(0,0,0,0.2)' }}
            />
            <button type="button" className="pill-dark" disabled={busy || !code} onClick={verifyCode}>
              Unlock
            </button>
          </>
        ) : (
          <button type="button" className="ghost" disabled={busy} onClick={lockNow}>
            Lock now
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gap: 12, maxWidth: 420 }}>
        <label>
          <span className="empty">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!unlocked || busy}
            style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 10px' }}
          />
        </label>
        <label>
          <span className="empty">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={!unlocked || busy}
            style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 10px' }}
          />
        </label>
        <label>
          <span className="empty">Phone</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={!unlocked || busy}
            style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 10px' }}
          />
        </label>
        {unlocked && (
          <button type="button" className="pill-dark" disabled={busy} onClick={save} style={{ justifySelf: 'start' }}>
            {busy ? '…' : 'Save'}
          </button>
        )}
      </div>

      {!isSelf && (
        <>
          <h2 className="page-h1" style={{ marginTop: 40, fontSize: 22 }}>
            Danger zone
          </h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {deactivated ? (
              <button type="button" className="pill-dark" disabled={busy} onClick={restore}>
                Restore
              </button>
            ) : (
              <button type="button" className="pill-dark" disabled={busy} onClick={() => setDeleteKind('soft')}>
                Deactivate
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => setDeleteKind('hard')}
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
              Delete permanently
            </button>
          </div>
        </>
      )}

      <PasswordDeleteModal
        open={deleteKind !== null}
        title={
          deleteKind === 'hard' ? `Permanently delete ${labelOf(user)}?` : `Deactivate ${labelOf(user)}?`
        }
        body={
          deleteKind === 'hard'
            ? 'This erases their account and ALL brands and data. This cannot be undone.'
            : 'Their brands will be paused. You can restore them later.'
        }
        confirmLabel={deleteKind === 'hard' ? 'Delete forever' : 'Deactivate'}
        requirePassword={deleteKind === 'hard'}
        busy={busy}
        onCancel={() => setDeleteKind(null)}
        onConfirm={runDelete}
      />
    </div>
  );
}
