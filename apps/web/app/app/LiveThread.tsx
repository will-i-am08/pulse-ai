'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
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
  const chatRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const stickToBottom = useRef(true);
  const lastIdsRef = useRef(initialMessages.map((m) => m.id).join(','));

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

  function onSubmit(formData: FormData) {
    stickToBottom.current = true;
    startTransition(async () => {
      await sendChatMessageAction(formData);
      formRef.current?.reset();
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
        <form className="composer" ref={formRef} action={onSubmit}>
          <input
            name="q"
            placeholder="Tell Kip what to post…"
            aria-label="Message Kip"
            required
            disabled={pending}
          />
          <button className="pill-dark" type="submit" disabled={pending} aria-busy={pending}>
            {pending ? 'Sending…' : 'Send'}
          </button>
        </form>
      </div>
    </section>
  );
}
