# Operator Runbook — setup, deploy, go-live

Everything you need to take this from repo to running client. Order matters:
the two review queues (Meta, Twilio AU) are slow and outside your control, so
they start on **day one** while the rest is set up in parallel.

## 0. Critical path first (start today)

| Queue | Why | Typical wait |
|---|---|---|
| **Meta App Review** (`instagram_content_publish`) | Nothing publishes to a real IG without it | 1–3 weeks incl. business verification |
| **Twilio AU sender registration** | Required for reliable AU SMS delivery | Hours–days |

Everything else can be built and tested against mocks while these clear.

## 1. Neon (Postgres)

1. Use the existing Neon project (`super-leaf-19361791`, branch `production`) or
   create a dedicated one. Grab the connection string → `DATABASE_URL`
   (and `NEON_PROJECT_ID`).
2. Apply the schema: `pnpm exec tsx --env-file=.env scripts/migrate.ts` — it runs
   `db/migrations/*.sql` in order and is idempotent (safe to re-run).
3. Storage: **none needed.** Media bytes are stored in Postgres and served from
   the dashboard's public `/api/media/[id]` route.
4. Auth: **single-operator email + password**. Set a random `AUTH_SECRET`
   (`openssl rand -base64 32`) to sign the session cookie, then create the operator:
   `ADMIN_PASSWORD=... pnpm exec tsx --env-file=.env scripts/create-admin.ts will@jmcalder.com`.

## 2. Anthropic
- `ANTHROPIC_API_KEY` from console.anthropic.com.
- Models: `DRAFT_MODEL=claude-haiku-4-5-20251001`, `FALLBACK_MODEL=claude-sonnet-5`.

## 3. Twilio (SMS/MMS, Australia)
1. Create a Twilio account; buy an **Australian number** with SMS + MMS.
2. Complete AU sender registration / compliance for the number.
3. Set the number's **inbound webhook** (Messaging → A message comes in) to:
   `https://<your-vercel-domain>/api/webhooks/twilio` (POST).
4. Grab: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`.
5. Set `OPERATOR_PHONE` to your own mobile (E.164, e.g. `+6141...`) — where
   operator-approver drafts and failure alerts go.

## 4. Meta Graph API (do the review in parallel)
Prerequisites and the App Review permission list are in the build notes; the
short version:
1. Meta Developer account + **Business verification** (needs ABN; slowest step).
2. Create a **Business** app; add Instagram Graph API + Facebook Login.
3. Client's IG must be **Professional**, linked to a **Facebook Page** they admin.
4. Submit for App Review requesting: `instagram_basic`, `instagram_content_publish`,
   `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `business_management`.
5. Until approved: keep `GRAPH_MODE=mock`. After approval: `GRAPH_MODE=live`,
   fill `META_APP_ID` / `META_APP_SECRET`, store each brand's page/IG tokens
   (encrypted — the app does this via `TOKEN_ENCRYPTION_KEY`).

## 5. Security key
```bash
openssl rand -base64 32   # → TOKEN_ENCRYPTION_KEY
```
Platform tokens are encrypted at rest with this (AES-256-GCM). Keep it out of git.

## 6. Deploy — dashboard + webhook (Vercel)
- Import the repo; set **root** to the monorepo, framework **Next.js**, project = `apps/web`.
- Env: `DATABASE_URL`, `NEON_PROJECT_ID`, `AUTH_SECRET`, `OPERATOR_PASSWORD`,
  `ANTHROPIC_API_KEY`, `TWILIO_*`, `OPERATOR_PHONE`, `GRAPH_MODE`, `META_*`,
  `TOKEN_ENCRYPTION_KEY`, `APP_BASE_URL` (your Vercel URL). See `.env.example`.
- The webhook route runs on the **Node.js runtime** (not Edge) — already set in code.

## 7. Deploy — worker (Railway)
- New Railway service from the repo; start command runs `apps/worker`.
- Same env as above (server-side keys — no `NEXT_PUBLIC_*` needed).
- It's a persistent process (node-cron): publish loop every minute + proactive
  triggers on their schedules. No pg_cron required.

## 8. Go-live checklist (the milestone gates)
1. **Round-trip**: text a photo to the Twilio number → within a minute it's a
   `media_assets` row linked to the right brand, and you get a drafted-caption reply.
2. **Approve**: reply `yes` → post goes `approved`; reply an edit → the edit is
   stored as a correction *and* folded into the brand voice profile.
3. **Publish** (mock first): approved post flips to `published` on schedule;
   force a failure → you get an operator alert, it does not fail silently.
4. **Proactive**: weekly check-in fires unprompted; a brand that messaged in the
   last 24h is correctly skipped.
5. **Report**: weekly report pulls engagement (mock, then live) and sends an
   accurate summary. Three real clients, two weeks, no manual step beyond
   approval = **MVP done**.

## Approval is absolute
No code path publishes without a logged `approved` action. Every draft, approval,
edit, publish, and failure is written to `approval_log`. If you ever see a post
published without an `approved` row, that's a bug — stop and report it.
