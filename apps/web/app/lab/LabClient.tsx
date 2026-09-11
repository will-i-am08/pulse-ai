"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import styles from "./lab.module.css";

type Note = {
  id: string;
  target_type: string;
  target_id: string;
  body: string;
  created_at: string;
};

type MediaRef = { id: string; url: string };

type ThreadMessage = {
  id: string;
  direction: "inbound" | "outbound";
  body: string | null;
  created_at: string;
  media: MediaRef[];
  notes: Note[];
};

type ActionRow = {
  id: string;
  post_id: string | null;
  action: string;
  actor: string | null;
  note: string | null;
  created_at: string;
  notes: Note[];
};

type PostRow = {
  id: string;
  caption: string | null;
  status: string;
  platform: string;
  media: MediaRef[];
  notes: Note[];
  created_at: string;
};

type BrandInfo = {
  id: string;
  name: string;
  client_phone: string;
  onboarding_state: { status?: string } | null;
  facts: Record<string, unknown> | null;
};

type ChatSummary = {
  id: string;
  title: string;
  status: "active" | "archived";
  started_at: string;
  archived_at: string | null;
  message_count: number;
};

type ThreadPayload = {
  brand: BrandInfo;
  messages: ThreadMessage[];
  actions: ActionRow[];
  posts: PostRow[];
  onboardingNotes: Note[];
  chats?: ChatSummary[];
  activeChatId?: string | null;
  readOnly?: boolean;
};

type NoteTarget = { type: string; id: string; label: string };

export function LabClient() {
  const [thread, setThread] = useState<ThreadPayload | null>(null);
  const [viewChatId, setViewChatId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [noteTarget, setNoteTarget] = useState<NoteTarget | null>(null);
  const [noteBody, setNoteBody] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const qs = viewChatId ? `?chatId=${encodeURIComponent(viewChatId)}` : "";
      const res = await fetch(`/api/lab/thread${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      setThread((await res.json()) as ThreadPayload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load thread");
    }
  }, [viewChatId]);

  useEffect(() => {
    void load();
    if (viewChatId) return;
    const id = setInterval(() => void load(), 4000);
    return () => clearInterval(id);
  }, [load, viewChatId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread?.messages.length]);

  const readOnly = Boolean(viewChatId) || Boolean(thread?.readOnly);

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!thread || busy || readOnly) return;
    if (!text.trim() && files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("brandId", thread.brand.id);
      form.set("body", text);
      for (const file of files) form.append("media", file);
      const res = await fetch("/api/lab/message", { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text());
      setText("");
      setFiles([]);
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setBusy(false);
    }
  }

  async function restartOnboarding() {
    if (!thread || busy) return;
    if (
      !confirm(
        "Start a new chat? The current thread will be saved so you can reopen it. Kip won’t remember it.",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/lab/onboarding/restart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brandId: thread.brand.id }),
      });
      if (!res.ok) throw new Error(await res.text());
      setViewChatId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Restart failed");
    } finally {
      setBusy(false);
    }
  }

  async function hardReset() {
    if (!thread || busy) return;
    if (!confirm("Hard reset lab brand? This wipes messages, posts, notes, and voice.")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/lab/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brandId: thread.brand.id }),
      });
      if (!res.ok) throw new Error(await res.text());
      setViewChatId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveNote() {
    if (!thread || !noteTarget || !noteBody.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/lab/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          brandId: thread.brand.id,
          targetType: noteTarget.type,
          targetId: noteTarget.id,
          body: noteBody.trim(),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setNoteBody("");
      setNoteTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Note failed");
    } finally {
      setBusy(false);
    }
  }

  async function deleteNote(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/lab/notes/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  const onboardingStatus = thread?.brand.onboarding_state?.status ?? "none";

  return (
    <div className={styles.shell}>
      <header className={styles.top}>
        <div>
          <p className={styles.eyebrow}>Agent lab · Twilio-free</p>
          <h1>{thread?.brand.name ?? "Lab"}</h1>
          <p className={styles.meta}>
            {thread?.brand.client_phone ?? "…"} · onboarding: <strong>{onboardingStatus}</strong>
          </p>
        </div>
        <div className={styles.actions}>
          <label className={styles.chatPicker}>
            <span>Chat</span>
            <select
              value={viewChatId ?? ""}
              onChange={(e) => setViewChatId(e.target.value || null)}
              disabled={busy}
            >
              <option value="">Live chat</option>
              {(thread?.chats ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title} ({c.message_count})
                </option>
              ))}
            </select>
          </label>
          <button type="button" className={styles.btn} onClick={() => void load()} disabled={busy}>
            Refresh
          </button>
          <button
            type="button"
            className={styles.btn}
            onClick={() => void restartOnboarding()}
            disabled={busy || readOnly}
          >
            New chat
          </button>
          <button type="button" className={styles.btnDanger} onClick={() => void hardReset()} disabled={busy}>
            Hard reset
          </button>
        </div>
      </header>

      {error && <p className={styles.error}>{error}</p>}
      {readOnly && (
        <p className={styles.banner}>
          Viewing a saved chat (read-only). Switch to{" "}
          <button type="button" className={styles.linkish} onClick={() => setViewChatId(null)}>
            Live chat
          </button>{" "}
          to keep testing.
        </p>
      )}

      <div className={styles.grid}>
        <section className={styles.threadPane}>
          <div className={styles.thread}>
            {(thread?.messages ?? []).map((m) => (
              <article
                key={m.id}
                className={m.direction === "inbound" ? styles.bubbleIn : styles.bubbleOut}
              >
                <button
                  type="button"
                  className={styles.bubbleBtn}
                  onClick={() =>
                    setNoteTarget({
                      type: "message",
                      id: m.id,
                      label: `${m.direction} · ${m.body?.slice(0, 40) ?? "media"}`,
                    })
                  }
                >
                  {m.body && <p>{m.body}</p>}
                  {m.media?.length > 0 && (
                    <div className={styles.mediaRow}>
                      {m.media.map((media) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={media.id} src={media.url} alt="" className={styles.thumb} />
                      ))}
                    </div>
                  )}
                  <time>{new Date(m.created_at).toLocaleTimeString()}</time>
                </button>
                {m.notes?.length > 0 && (
                  <ul className={styles.noteList}>
                    {m.notes.map((n) => (
                      <li key={n.id}>
                        <span>{n.body}</span>
                        {!readOnly && (
                          <button type="button" onClick={() => void deleteNote(n.id)}>
                            ×
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
            <div ref={bottomRef} />
          </div>

          {readOnly ? (
            <div className={styles.composerDisabled}>Saved chat — switch to Live chat to send.</div>
          ) : (
            <form className={styles.composer} onSubmit={(e) => void sendMessage(e)}>
              {files.length > 0 && (
                <p className={styles.fileHint}>
                  {files.length} file{files.length === 1 ? "" : "s"} attached{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setFiles([]);
                      if (fileRef.current) fileRef.current.value = "";
                    }}
                  >
                    clear
                  </button>
                </p>
              )}
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Text the agent…"
                rows={3}
                disabled={busy}
              />
              <div className={styles.composerRow}>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                />
                <button type="submit" className={styles.btnPrimary} disabled={busy}>
                  {busy ? "Sending…" : "Send"}
                </button>
              </div>
            </form>
          )}
        </section>

        <aside className={styles.rail}>
          <div className={styles.railBlock}>
            <div className={styles.railHead}>
              <h2>Actions</h2>
              <button
                type="button"
                className={styles.linkish}
                onClick={() =>
                  thread &&
                  setNoteTarget({ type: "onboarding", id: thread.brand.id, label: "Onboarding" })
                }
              >
                Note onboarding
              </button>
            </div>
            <ul className={styles.railList}>
              {(thread?.actions ?? []).map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    className={styles.railItem}
                    onClick={() => setNoteTarget({ type: "approval_log", id: a.id, label: a.action })}
                  >
                    <strong>{a.action}</strong>
                    <span>{new Date(a.created_at).toLocaleString()}</span>
                    {a.note && <em>{a.note}</em>}
                  </button>
                  {a.notes?.map((n) => (
                    <p key={n.id} className={styles.inlineNote}>
                      {n.body}{" "}
                      {!readOnly && (
                        <button type="button" onClick={() => void deleteNote(n.id)}>
                          ×
                        </button>
                      )}
                    </p>
                  ))}
                </li>
              ))}
              {!thread?.actions?.length && <li className={styles.empty}>No actions yet</li>}
            </ul>
          </div>

          <div className={styles.railBlock}>
            <h2>Posts</h2>
            <ul className={styles.railList}>
              {(thread?.posts ?? []).map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={styles.railItem}
                    onClick={() =>
                      setNoteTarget({ type: "post", id: p.id, label: `${p.platform} · ${p.status}` })
                    }
                  >
                    <strong>
                      {p.platform} · {p.status}
                    </strong>
                    <span>{p.caption?.slice(0, 80) ?? "(no caption)"}</span>
                  </button>
                  {p.notes?.map((n) => (
                    <p key={n.id} className={styles.inlineNote}>
                      {n.body}{" "}
                      {!readOnly && (
                        <button type="button" onClick={() => void deleteNote(n.id)}>
                          ×
                        </button>
                      )}
                    </p>
                  ))}
                </li>
              ))}
              {!thread?.posts?.length && <li className={styles.empty}>No posts yet</li>}
            </ul>
          </div>

          {(thread?.onboardingNotes?.length ?? 0) > 0 && (
            <div className={styles.railBlock}>
              <h2>Onboarding notes</h2>
              <ul className={styles.noteList}>
                {thread!.onboardingNotes.map((n) => (
                  <li key={n.id}>
                    <span>{n.body}</span>
                    {!readOnly && (
                      <button type="button" onClick={() => void deleteNote(n.id)}>
                        ×
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {noteTarget && !readOnly && (
            <div className={styles.noteComposer}>
              <p>
                Comment on <strong>{noteTarget.label}</strong>
              </p>
              <textarea
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                rows={3}
                placeholder="What should change?"
              />
              <div className={styles.composerRow}>
                <button type="button" className={styles.btn} onClick={() => setNoteTarget(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles.btnPrimary}
                  onClick={() => void saveNote()}
                  disabled={busy}
                >
                  Save note
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
