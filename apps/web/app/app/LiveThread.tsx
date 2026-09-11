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
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);
  const chatRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stickToBottom = useRef(true);
  const lastIdsRef = useRef(initialMessages.map((m) => m.id).join(','));

  const clearPhotos = useCallback(() => {
    setPhotos((prev) => {
      for (const p of prev) URL.revokeObjectURL(p.url);
      return [];
    });
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
    const picked = e.target.files;
    if (!picked || picked.length === 0) return;
    const added = Array.from(picked).map((file) => ({ file, url: URL.createObjectURL(file) }));
    setPhotos((prev) => [...prev, ...added]);
    // Reset the input so re-picking the same file, or adding more in a second
    // pick, both work — we keep the File objects in state, not the input.
    e.target.value = '';
  }

  function removePhoto(index: number) {
    setPhotos((prev) => {
      const gone = prev[index];
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter((_, i) => i !== index);
    });
  }

  // We build the FormData from state (not the native form) so per-photo removals
  // and multi-pick accumulation are honoured — a file <input> can't be mutated.
  function onSubmit() {
    if (!text.trim() && photos.length === 0) return;
    const formData = new FormData();
    formData.set('q', text);
    for (const p of photos) formData.append('photo', p.file);
    stickToBottom.current = true;
    startTransition(async () => {
      await sendChatMessageAction(formData);
      setText('');
      clearPhotos();
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
        {photos.length > 0 && (
          <div className="composer-previews">
            {photos.map((p, i) => (
              <div key={p.url} className="composer-thumb">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={p.file.name} />
                <button
                  type="button"
                  className="composer-thumb-remove"
                  onClick={() => removePhoto(i)}
                  aria-label={`Remove ${p.file.name}`}
                  disabled={pending}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <form className="composer" ref={formRef} action={onSubmit}>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={onPhotoChange}
            disabled={pending}
          />
          <button
            type="button"
            className="composer-attach"
            onClick={() => fileRef.current?.click()}
            aria-label="Attach photos"
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
            placeholder={photos.length > 0 ? 'Add a note (optional)…' : 'Tell Kip what to post…'}
            aria-label="Message Kip"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={pending}
          />
          <button
            className="pill-dark"
            type="submit"
            disabled={pending || (!text.trim() && photos.length === 0)}
            aria-busy={pending}
          >
            {pending ? 'Sending…' : 'Send'}
          </button>
        </form>
      </div>
    </section>
  );
}
