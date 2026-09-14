// Chat watch: polls Pulse AI's message tables and reviews every inbound and
// outbound message for bot-quality and UX issues. Runs forever in background:
//
//   tsx --env-file=.env scripts/chat-watch.ts >> /tmp/pulse-chat-watch.log 2>&1 &
//
// Findings append to docs/CHAT_REVIEW_LOG.md. Cursor lives in
// /tmp/pulse-chat-watch.cursor (timestamps only, no secrets).
//
// What it checks per tick:
//   - nag bursts: 3+ proactive outbound nudges to one brand within 2h
//   - unanswered inbound: owner message with no reply within 15 min
//   - failed inbound rows (pending_inbound status='failed')
//   - negative interactions that never escalated
// Anything found (or any fresh traffic at all) gets a Haiku review pass and
// is logged. Quiet ticks stay quiet.
import pg from "pg";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const CURSOR = "/tmp/pulse-chat-watch.cursor";
const LOG = "docs/CHAT_REVIEW_LOG.md";
const POLL_MS = 60_000;
const NAG_WINDOW_HOURS = 2;
const NAG_THRESHOLD = 3;
const REPLY_GRACE_MIN = 15;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("chat-watch: DATABASE_URL is not set");
  process.exit(2);
}
const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

function loadCursor(): string {
  try {
    if (existsSync(CURSOR)) return readFileSync(CURSOR, "utf8").trim();
  } catch { /* fresh start */ }
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

function saveCursor(iso: string): void {
  writeFileSync(CURSOR, iso);
}

function log(section: string): void {
  appendFileSync(LOG, section);
}

async function callHaiku(system: string, user: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return "(no ANTHROPIC_API_KEY — heuristic findings only)";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.DRAFT_MODEL ?? "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) return `(review call failed: ${res.status})`;
  const body = (await res.json()) as any;
  return (body.content?.[0]?.text ?? "(empty review)").trim();
}

type Msg = {
  id: string;
  brand_id: string;
  brand: string;
  direction: string;
  channel: string;
  body: string | null;
  created_at: string;
};

async function tick(): Promise<void> {
  const since = loadCursor();
  const now = new Date().toISOString();

  const { rows: fresh } = await db.query<Msg>(
    `select m.id, m.brand_id, b.name as brand, m.direction, m.channel,
            left(coalesce(m.body, ''), 300) as body, m.created_at
       from messages m join brands b on b.id = m.brand_id
       where m.created_at > $1
       order by m.created_at asc
       limit 100`,
    [since],
  );
  const { rows: failed } = await db.query(
    `select p.channel, left(coalesce(p.body, ''), 120) as body, p.created_at, b.name as brand
       from pending_inbound p left join brands b on true
       where p.status = 'failed' and p.created_at > $1
       order by p.created_at asc limit 20`,
    [since],
  );
  const { rows: unhandledNeg } = await db.query(
    `select i.platform, i.kind, left(coalesce(i.text, ''), 120) as text, i.status, i.created_at, b.name as brand
       from interactions i join brands b on b.id = i.brand_id
       where i.sentiment = 'negative' and i.status not in ('escalated', 'resolved', 'hidden')
         and i.created_at > $1
       order by i.created_at asc limit 20`,
    [since],
  );
  if (fresh.length === 0 && failed.length === 0 && unhandledNeg.length === 0) return;
  saveCursor(now);

  // Heuristic 1: nag bursts — proactive outbound clusters per brand.
  const nudges = fresh.filter(
    (m) =>
      m.direction === "outbound" &&
      /heads up|quick nudge|still waiting|light this week/i.test(m.body ?? ""),
  );
  const byBrand = new Map<string, Msg[]>();
  for (const n of nudges) {
    const list = byBrand.get(n.brand_id) ?? [];
    list.push(n);
    byBrand.set(n.brand_id, list);
  }
  const bursts: string[] = [];
  for (const [brandId, list] of byBrand) {
    for (let i = 0; i < list.length; i++) {
      const anchor = list[i];
      if (!anchor) continue;
      const anchorMs = new Date(anchor.created_at).getTime();
      const window = list.filter(
        (m) => new Date(m.created_at).getTime() - anchorMs < NAG_WINDOW_HOURS * 3_600_000,
      );
      if (window.length >= NAG_THRESHOLD) {
        bursts.push(
          `${anchor.brand}: ${window.length} nudges within ${NAG_WINDOW_HOURS}h (e.g. "${(window[0]?.body ?? "").slice(0, 80)}…")`,
        );
        break;
      }
    }
    void brandId;
  }

  // Heuristic 2: unanswered inbound — no outbound on the same brand+channel after it.
  const silent: string[] = [];
  for (const m of fresh.filter((x) => x.direction === "inbound")) {
    const answered = fresh.some(
      (o) =>
        o.direction === "outbound" &&
        o.brand_id === m.brand_id &&
        o.channel === m.channel &&
        new Date(o.created_at) > new Date(m.created_at),
    );
    if (!answered) {
      const ageMin = Math.round((Date.now() - new Date(m.created_at).getTime()) / 60_000);
      if (ageMin >= REPLY_GRACE_MIN) {
        silent.push(`${m.brand} via ${m.channel} ${ageMin} min ago: "${(m.body ?? "").slice(0, 100)}" — no reply on record`);
      }
    }
  }

  // Heuristic 3: robotic repetition — same opener / same CTA / markdown leakage.
  const outbound = fresh.filter((m) => m.direction === "outbound" && (m.body ?? "").trim());
  const repeatedOpeners: string[] = [];
  const repeatedCtas: string[] = [];
  const markdownLeaks: string[] = [];
  const openerCounts = new Map<string, { brand: string; count: number; sample: string }>();
  const ctaCounts = new Map<string, { brand: string; count: number; sample: string }>();
  for (const m of outbound) {
    const body = (m.body ?? "").trim();
    if (/(\*\*|__|^\s*[-*]\s|^\s*#\s|[—–])/m.test(body)) {
      markdownLeaks.push(`${m.brand}: markdown/em-dash leak in "${body.slice(0, 80)}…"`);
    }
    const opener = body.split(/[.!?\n]/)[0]?.trim().toLowerCase().slice(0, 48) ?? "";
    if (opener.split(/\s+/).length >= 3) {
      const key = `${m.brand_id}::${opener}`;
      const prev = openerCounts.get(key);
      openerCounts.set(key, {
        brand: m.brand,
        count: (prev?.count ?? 0) + 1,
        sample: body.slice(0, 80),
      });
    }
    const cta =
      body.match(/\b(want me to|shall i|got a photo|say the word|fire over|reply (yes|yep)|approve)\b/i)?.[0]?.toLowerCase() ??
      "";
    if (cta) {
      const key = `${m.brand_id}::${cta}`;
      const prev = ctaCounts.get(key);
      ctaCounts.set(key, {
        brand: m.brand,
        count: (prev?.count ?? 0) + 1,
        sample: body.slice(0, 80),
      });
    }
  }
  for (const v of openerCounts.values()) {
    if (v.count >= 2) {
      repeatedOpeners.push(`${v.brand}: opener ×${v.count} ("${v.sample}…")`);
    }
  }
  for (const v of ctaCounts.values()) {
    if (v.count >= 2) {
      repeatedCtas.push(`${v.brand}: CTA "${v.sample.slice(0, 40)}" ×${v.count}`);
    }
  }

  const transcript = fresh
    .map((m) => `[${m.created_at}] ${m.brand} ${m.direction}/${m.channel}: ${(m.body ?? "").slice(0, 200)}`)
    .join("\n");

  const review = await callHaiku(
    "You review Pulse AI's owner-facing chat for bot-quality and UX problems. Be blunt and specific. " +
      "Flag: nagging/repetitive proactive messages, repeated openers or CTAs, unanswered owner messages, " +
      "markdown/em-dash leakage, confusing wording, tone issues, missing acknowledgements, anything that " +
      "would annoy a paying client. Reply in 3 short bullet points max, or 'All quiet.' if genuinely fine.",
    `Heuristic findings:\n- nag bursts: ${bursts.length ? bursts.join(" | ") : "none"}\n` +
      `- unanswered inbound: ${silent.length ? silent.join(" | ") : "none"}\n` +
      `- repeated openers: ${repeatedOpeners.length ? repeatedOpeners.join(" | ") : "none"}\n` +
      `- repeated CTAs: ${repeatedCtas.length ? repeatedCtas.join(" | ") : "none"}\n` +
      `- markdown/em-dash leaks: ${markdownLeaks.length ? markdownLeaks.join(" | ") : "none"}\n` +
      `- failed inbound rows: ${failed.length ? failed.map((f: any) => `${f.brand ?? "?"} ${f.channel}: "${f.body}"`).join(" | ") : "none"}\n` +
      `- negative interactions not escalated: ${unhandledNeg.length ? unhandledNeg.map((n: any) => `${n.brand} ${n.kind}: "${n.text}" (${n.status})`).join(" | ") : "none"}\n\n` +
      `Fresh transcript:\n${transcript || "(none)"}`,
  );

  const stamp = new Date().toISOString();
  log(
    `\n## ${stamp}\n\n**Heuristics**\n\n` +
      `- nag bursts: ${bursts.length ? bursts.join("; ") : "none"}\n` +
      `- unanswered inbound: ${silent.length ? silent.join("; ") : "none"}\n` +
      `- repeated openers: ${repeatedOpeners.length ? repeatedOpeners.join("; ") : "none"}\n` +
      `- repeated CTAs: ${repeatedCtas.length ? repeatedCtas.join("; ") : "none"}\n` +
      `- markdown/em-dash leaks: ${markdownLeaks.length ? markdownLeaks.join("; ") : "none"}\n` +
      `- failed inbound: ${failed.length}\n- unhandled negatives: ${unhandledNeg.length}\n\n` +
      `**Review**\n\n${review}\n`,
  );
  console.log(`[${stamp}] watch tick: ${fresh.length} msgs, review logged`);
}

async function main(): Promise<void> {
  await db.connect();
  console.log("chat-watch: watching messages (tick 60s)");
  for (;;) {
    try {
      await tick();
    } catch (err) {
      console.error("chat-watch tick failed:", err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((e) => {
  console.error("chat-watch fatal:", e);
  process.exit(1);
});
