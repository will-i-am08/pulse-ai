# Kip

<p align="center">
  <img src="apps/web/public/brand/kip-logo.png" alt="Kip" width="160" />
</p>

An SMS-first social-media agent: clients text photos/video, the agent drafts an
in-brand caption, you approve/edit/reject in the thread, and it publishes to
Instagram + Facebook on schedule. It also messages clients first — weekly
check-ins and performance reports — and learns each brand's voice from every
correction.

Visual identity: [`docs/DESIGN.md`](docs/DESIGN.md). MVP scope, architecture, and
the decisions behind them: [`docs/BUILD_CONTRACTS.md`](docs/BUILD_CONTRACTS.md).

## Shape

```
pulse-agent/  (pnpm workspaces)
├── packages/
│   ├── shared/           @pulse/shared        types, MessageChannel, env, crypto, db
│   ├── channel-twilio/   @pulse/channel-twilio Twilio SMS/MMS adapter
│   ├── gateway/          @pulse/gateway       inbound routing, media capture, outbound send (Twilio + Linq)
│   ├── orchestrator/     @pulse/orchestrator  classify, draft, learn (Anthropic)
│   └── graph/            @pulse/graph         Meta Graph adapter (mock | live)
├── apps/
│   ├── web/              @pulse/web           Next.js dashboard + webhooks → Vercel
│   └── worker/           @pulse/worker        publish + proactive SMS loops → Railway
└── db/migrations/        canonical schema (Neon Postgres)
```

- **Vercel** hosts the dashboard + inbound webhooks (Twilio, Linq, Meta).
- **Railway** hosts the persistent worker (publish, engagement, gap-fill, digests, Linq drain).
- **Neon** is the Postgres database; media bytes live in Postgres and are served
  from the dashboard's public `/api/media/[id]` route.
- **Channel:** Twilio SMS/MMS primary (`MESSAGE_CHANNEL=twilio`); Linq iMessage end-state.

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
