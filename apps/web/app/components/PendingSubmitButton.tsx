'use client';

import { useFormStatus } from 'react-dom';
import styles from '../auth.module.css';

type Props = {
  idleLabel: string;
  pendingLabel?: string;
  /** Defaults to the primary auth button style. */
  className?: string;
};

/**
 * Submit button that shows a spinner while a server action is in flight.
 * Must render as a descendant of the <form> that owns the action.
 */
export function PendingSubmitButton({ idleLabel, pendingLabel, className }: Props) {
  const { pending } = useFormStatus();
  const label = pending ? (pendingLabel ?? idleLabel) : idleLabel;

  return (
    <button
      className={`${className ?? styles.button}${pending ? ` ${styles.buttonPending}` : ''}`}
      type="submit"
      disabled={pending}
      aria-busy={pending}
    >
      {pending && <span className={styles.spinner} aria-hidden="true" />}
      <span>{label}</span>
    </button>
  );
}
