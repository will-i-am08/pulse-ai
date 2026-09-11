'use client';

import { type ChangeEvent, useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { sendChatMessageAction } from '@/lib/actions/chat';
import type { ThreadMessageDto } from '@/lib/thread';

export type LiveThreadMessage = ThreadMessageDto;

type Props = {
  /** First name for the empty-state greeting. */
  firstName?: string | null;
  /** SSR snapshot so the thread paints immediately. */
  initialMessages: LiveThreadMessage[];
};

const POLL_MS = 3000;

function nearBottom(el: HTMLElement, px = 80): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < px;
}

/**
 * Owner ↔ Kip thread with light polling so SMS/web replies appear without a
 * full page reload. Pauses while the tab is hidden.
 */
export function LiveThread({ firstName, initialMessages }: Props) {
  const [messages, setMessages] = useState<LiveThreadMessage[]>(initialMessages);
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState('');
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoName, setPhotoName] = useState<string | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stickToBottom = useRef(true);
  const lastIdsRef = useRef(initialMessages.map((m) => m.id).join(','));

  const clearPhoto = useCallback(() => {
    setPhotoPreview((url) => {
      if (url) URL.revokeObjectURL(url);
      return null;
    });
    setPhotoName(null);
    if (fileRef.current) fileRef.current.value = '';
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/app/thread', { cache: 'no-store' });
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as { messages: LiveThreadMessage[] };
      const next = data.messages ?? [];
      const key = next.map((m) => m.id).join(',');
      if (key === lastIdsRef.current) return;
      lastIdsRef.current = key;
      setMessages(next);
    } catch {
      // Transient network blip — next tick retries.
    }
  }, []);

  useEffect(() => {
    setMessages(initialMessages);
    lastIdsRef.current = initialMessages.map((m) => m.id).join(',');
  }, [initialMessages]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') void load();
      }, POLL_MS);
    };
    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void load();
        start();
      } else {
        stop();
      }
    };

    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load]);

  useEffect(() => {
    const el = chatRef.current;
    if (!el || !stickToBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  function onScroll() {
    const el = chatRef.current;
    if (!el) return;
    stickToBottom.current = nearBottom(el);
  }

  function onPhotoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      clearPhoto();
      return;
    }
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(URL.createObjectURL(file));
    setPhotoName(file.name);
  }

  function onSubmit(formData: FormData) {
    // Guard the empty submit that a bare Enter/Send could otherwise fire.
    if (!text.trim() && !photoName) return;
    stickToBottom.current = true;
    startTransition(async () => {
      await sendChatMessageAction(formData);
      formRef.current?.reset();
      setText('');
      clearPhoto();
      // Pull immediately, then again shortly after Kip's reply lands.
      await load();
      window.setTimeout(() => void load(), 1200);
      window.setTimeout(() => void load(), 3000);
    });
  }

  return (
    <section className="stage">
      <div className="chat" ref={chatRef} onScroll={onScroll}>
        {messages.length === 0 ? (
          <div className="bubble kip">
            <p>
              Hi{firstName ? ` ${firstName}` : ''} — I’m Kip. Text me a photo from the floor and I’ll
              draft a post in your voice. Nothing goes out without your yes.
            </p>
          </div>
        ) : (
          messages.map((m) => {
            const mine = m.direction === 'inbound';
            return (
              <div key={m.id} className={`bubble ${mine ? 'you' : 'kip'}`}>
                {m.mediaUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.mediaUrl} alt="" />
                )}
                {m.body && <p>{m.body}</p>}
              </div>
            );
          })
        )}
      </div>
      <div className="dock">
        {photoPreview && (
          <div className="composer-preview">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoPreview} alt={photoName ?? 'Selected photo'} />
            <span className="composer-preview-name">{photoName}</span>
            <button
              type="button"
              className="composer-preview-remove"
              onClick={clearPhoto}
              aria-label="Remove photo"
              disabled={pending}
            >
              ×
            </button>
          </div>
        )}
        <form className="composer" ref={formRef} action={onSubmit}>
          <input
            ref={fileRef}
            type="file"
            name="photo"
            accept="image/*"
            hidden
            onChange={onPhotoChange}
            disabled={pending}
          />
          <button
            type="button"
            className="composer-attach"
            onClick={() => fileRef.current?.click()}
            aria-label="Attach a photo"
            disabled={pending}
          >
            {/* paperclip */}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <input
            name="q"
            placeholder={photoName ? 'Add a note (optional)…' : 'Tell Kip what to post…'}
            aria-label="Message Kip"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={pending}
          />
          <button
            className="pill-dark"
            type="submit"
            disabled={pending || (!text.trim() && !photoName)}
            aria-busy={pending}
          >
            {pending ? 'Sending…' : 'Send'}
          </button>
        </form>
      </div>
    </section>
  );
}
