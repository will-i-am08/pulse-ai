'use client';

import { useEffect, useId, useState } from 'react';

/**
 * Two-step delete confirmation: "Are you sure?" then re-enter OPERATOR_PASSWORD.
 * Soft deactivate can skip the password step via requirePassword=false.
 */
export default function PasswordDeleteModal({
  open,
  title,
  body,
  confirmLabel = 'Delete',
  requirePassword = true,
  busy = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  requirePassword?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (password: string) => void;
}) {
  const [step, setStep] = useState<'confirm' | 'password'>('confirm');
  const [password, setPassword] = useState('');
  const titleId = useId();

  useEffect(() => {
    if (open) {
      setStep('confirm');
      setPassword('');
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={onCancel}
    >
      <div
        className="brand-card"
        style={{ maxWidth: 420, width: '100%', margin: 0, background: '#fff' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} style={{ margin: '0 0 8px', fontSize: 20 }}>
          {step === 'confirm' ? title : 'Enter operator password'}
        </h2>
        <p className="empty" style={{ margin: '0 0 16px' }}>
          {step === 'confirm' ? body : 'Type the operator password to permanently delete this.'}
        </p>

        {step === 'password' && (
          <label style={{ display: 'block', marginBottom: 16 }}>
            <span className="empty">Operator password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              style={{ display: 'block', width: '100%', marginTop: 6, padding: '8px 10px', fontSize: 16 }}
              autoFocus
            />
          </label>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          {step === 'confirm' ? (
            <button
              type="button"
              disabled={busy}
              className="pill-dark"
              onClick={() => {
                if (requirePassword) setStep('password');
                else onConfirm('');
              }}
              style={
                requirePassword
                  ? undefined
                  : { background: '#c0392b', borderColor: '#c0392b' }
              }
            >
              {requirePassword ? 'Continue' : confirmLabel}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || !password}
              onClick={() => onConfirm(password)}
              style={{
                border: '1px solid #c0392b',
                color: '#fff',
                background: '#c0392b',
                borderRadius: 999,
                padding: '6px 14px',
                cursor: busy || !password ? 'default' : 'pointer',
                fontSize: 14,
              }}
            >
              {busy ? '…' : confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
