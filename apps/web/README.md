# @pulse/web

Operator-only dashboard for the Pulse texting agent, plus the Twilio inbound
webhook. Next.js 15 (App Router, TypeScript, ESM), deployed to Vercel.

## What's here

- `app/login/` — Supabase magic-link sign-in (single operator, no password).
- `app/auth/callback/route.ts` — exchanges the magic-link code for a session.
- `middleware.ts` — guards every route except `/api/webhooks/*`, `/privacy`,
  `/login`, and `/auth/*` (the callback has to be reachable before a session
  exists, or the login flow can never complete).
- `app/(dashboard)/` — brands list, add-brand + voice onboarding, brand
  detail (pending approvals with Approve / Save edit & approve / Reject),
  post history, brand-voice profile editor.
- `app/api/webhooks/twilio/route.ts` — Twilio inbound webhook. Node.js
  runtime, verifies the Twilio signature, hands off to `@pulse/gateway`.
- `app/privacy/page.tsx` — static privacy policy (required for Meta App
  Review).
- `lib/data/` — server-only Supabase queries (`serviceClient()` from
  `@pulse/shared`).
- `lib/actions/` — server actions (`'use server'`) backing every form.
- `lib/supabase/` — browser client (auth only) and cookie-bound server
  client (auth only; data access goes through `lib/data/`).

## Local dev

From the repo root (workspace-aware):

```bash
pnpm install
pnpm dev:web
```

This app depends on `@pulse/shared`, `@pulse/gateway`, and `@pulse/orchestrator`
as `workspace:*` — those packages need to exist (built by the other
workstreams) before `next dev` / `next build` / `pnpm typecheck` will resolve.

Env vars — see the root `.env.example` and copy the relevant values into
`apps/web/.env.local`:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — browser-safe,
  used for the magic-link sign-in and by the auth-cookie middleware.
- Everything else in `.env.example` (`SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `DRAFT_MODEL`,
  `FALLBACK_MODEL`, `TWILIO_*`, `OPERATOR_PHONE`, `GRAPH_MODE`, `META_*`,
  `TOKEN_ENCRYPTION_KEY`, `APP_BASE_URL`, `TZ`) — server-only. These are
  consumed directly by this app's server actions/route handlers *and* by the
  `@pulse/gateway` / `@pulse/orchestrator` code that runs inside them, so the
  full set is required even though `apps/web` doesn't call Twilio/Anthropic
  directly itself.

## Deploying to Vercel

1. Import the repo, set the **root directory** to `apps/web` (monorepo —
   Vercel's pnpm workspace detection handles the rest).
2. Add every var from `.env.example` to the Vercel project's Environment
   Variables (Production + Preview). `NEXT_PUBLIC_*` ones are the only two
   that need to be exposed to the browser; the rest stay server-side.
3. Set `APP_BASE_URL` to the deployed URL (e.g.
   `https://<your-app>.vercel.app`) — the webhook route uses this to
   reconstruct the exact URL Twilio signed against, so it must match what's
   registered in the Twilio console.
4. The webhook route (`app/api/webhooks/twilio/route.ts`) declares
   `export const runtime = 'nodejs'` — Vercel will run it as a Node.js
   serverless function, not Edge. No extra config needed, but don't remove
   that export.
5. **Twilio webhook URL**: `${APP_BASE_URL}/api/webhooks/twilio` — set this
   as the "A message comes in" webhook (HTTP POST) on the Twilio phone number
   used for `TWILIO_FROM_NUMBER`.

## Supabase Auth setup (integrator TODO)

- Enable the **Email** provider with magic link (OTP) in Supabase Auth
  settings. Password sign-up isn't used — this is a single-operator console.
- Add the deployed URL (and `http://localhost:3000` for local dev) to
  **Auth → URL Configuration → Redirect URLs**: `<APP_BASE_URL>/auth/callback`.
- Set **Site URL** to `APP_BASE_URL`.
- Create the one operator account (e.g. `will@jmcalder.com`) — either send
  yourself the first magic link from `/login`, or invite via the Supabase
  dashboard. There's no self-serve signup UI by design.
- Confirm the `brand-media` storage bucket referenced by `MEDIA_BUCKET` in
  `@pulse/shared` exists and is **private** (not public) — this app signs
  short-lived URLs per media preview rather than exposing the bucket.

## Assumptions made

- `/auth/*` is treated as a public path alongside `/api/webhooks/*`,
  `/privacy`, `/login` (not explicitly listed in the build contract) because
  the magic-link callback has to be reachable pre-session.
- The schema (`posts` table) has no `permalink` column, only
  `external_post_id` and `engagement` (jsonb). Post history shows a
  "View live post" link only if the worker recorded a `permalink` in the
  `after` payload of the `approval_log` row with `action='published'` for
  that post; otherwise it falls back to showing the external post ID.
- Media previews use 10-minute signed URLs generated per page load, not
  public URLs — consistent with "never persist a provider's short-lived URL"
  and treating `MEDIA_BUCKET` as private.
