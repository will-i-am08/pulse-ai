'use client';
import { useState } from 'react';

/**
 * A composer/form for surfaces whose "send" isn't wired to a backend yet
 * (in-app chat send, add-routine). It looks live but, on submit, tells the
 * user plainly where the real action happens instead of pretending.
 */
export function PreviewComposer({
  placeholder,
  button = 'Send',
  note,
}: {
  placeholder: string;
  button?: string;
  note: string;
}) {
  const [shown, setShown] = useState(false);

  return (
    <>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          setShown(true);
          e.currentTarget.reset();
        }}
      >
        <input name="q" placeholder={placeholder} aria-label={placeholder} />
        <button className="pill-dark" type="submit">
          {button}
        </button>
      </form>
      {shown && (
        <p className="empty" role="status" style={{ marginTop: 10 }}>
          {note}
        </p>
      )}
    </>
  );
}
