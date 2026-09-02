# Pulse Texting Agent

An SMS-first social-media agent: clients text photos/video, the agent drafts an
in-brand caption, you approve/edit/reject in the thread, and it publishes to
Instagram + Facebook on schedule. It also messages clients first — weekly
check-ins and performance reports — and learns each brand's voice from every
correction.

MVP scope, architecture, and the decisions behind them: see
[`docs/BUILD_CONTRACTS.md`](docs/BUILD_CONTRACTS.md) and the source spec.

## Shape

```
pulse-agent/  (pnpm workspaces)
├── packages/
│   ├── shared/           @pulse/shared        types, MessageChannel, env, crypto, db
│   ├── channel-twilio/   @pulse/channel-twilio Twilio SMS/MMS adapter
│   ├── gateway/          @pulse/gateway       inbound routing, media capture, outbound send
│   ├── orchestrator/     @pulse/orchestrator  classify, draft, learn (Anthropic)
│   └── graph/            @pulse/graph         Meta Graph adapter (mock | live)
├── apps/
│   ├── web/              @pulse/web           Next.js dashboard + inbound webhook → Vercel
│   └── worker/           @pulse/worker        publish loop + scheduler → Railway
└── db/migrations/        0001_init.sql        canonical schema (Neon Postgres)
```

- **Vercel** hosts the dashboard + inbound webhook (serverless, takes the traffic).
- **Railway** hosts the persistent worker (publish polling, retry/backoff, proactive triggers).
- **Neon** is the Postgres database; media bytes live in Postgres and are served
  from the dashboard's public `/api/media/[id]` route. Operator auth is a
  single-user password gate.

## Quick start

```bash
pnpm install
cp .env.example .env   # fill it in — see docs/RUNBOOK.md
# apply the schema to Neon:  pnpm exec tsx --env-file=.env scripts/migrate.ts
pnpm typecheck
pnpm dev:web      # dashboard on :3000
pnpm dev:worker   # worker loop
```

## Status

MVP build. Milestones 1–2 (messaging round-trip, draft/approve) run for real;
milestones 3–5 (scheduled publish, proactive messaging, performance reports)
run against a **mock** Meta Graph API (`GRAPH_MODE=mock`) until Meta App Review
clears, then flip to `live`. See [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

**Publishing to a real Instagram is gated on Meta App Review — start that first.**
