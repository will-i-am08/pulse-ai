# Project identity — read this before touching infra

**Pulse AI** and **Pulsepilot are two entirely separate things. Never mix them.**

## Pulse AI (this repo)

- **Repo:** `will-i-am08/pulse-ai` (this codebase)
- **Neon:** project `super-leaf-19361791`, branch `production` — the canonical prod database
  (2 brands, live posts/interactions/media as of Sep 2026).
- **Vercel:** project `web` (`web-tau-three-59.vercel.app`) — to be renamed to Pulse AI.
  This repo's `.vercel/project.json` is linked here. Deploy `apps/web` here only.
- **Railway:** project `pulse-worker`, service `worker` — the prod worker loop.
- **Channels:** Discord (now) → Twilio (interim) → Linq (end state, sandbox for now).

## Pulsepilot (separate — do not touch from this repo)

- **Vercel:** project `pulsepilot` (`pulsepilot-mu.vercel.app`)
- **Neon:** project `rough-butterfly-18954909`
- Nothing in this repo deploys there. Nothing there belongs to Pulse AI.

## Rules for agents

1. Never link this repo to the Pulsepilot Vercel project or Neon project.
2. Never run Pulse AI migrations against `rough-butterfly-18954909`.
3. Never copy env secrets between the two projects.
4. If a tool lists both (e.g. `vercel project ls`), double-check you are acting on
   the Pulse AI one (`web` / `super-leaf-19361791` / `pulse-worker`).
