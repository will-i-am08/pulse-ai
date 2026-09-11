# Kip — build status snapshot

_Living snapshot of what's built, what's gated, and what's next. Audited 2026-09-11 against the source. Pairs with [`ROADMAP.md`](ROADMAP.md), [`PHASE_I_CRM_SCOPE.md`](PHASE_I_CRM_SCOPE.md), and [`META_APP_REVIEW.md`](META_APP_REVIEW.md)._

**One-line verdict:** Phases **A–G are built** on this branch; **Phase H** (LinkedIn + TikTok) is Wave 3 next; **Phase I** is **scoped only** (no full CRM). The project remains **approval-blocked for Live Meta clients** — Business Verification is ✅; App Review submission is the remaining gate. Highest-ROI non-code work is finishing that submission.

- TypeScript monorepo (pnpm), audit-first (nothing publishes without a logged `approved` action).
- Stack: **Neon** Postgres · Vercel (dashboard + webhooks) · Railway (worker) · Anthropic · Meta Graph (mock→live) · optional X/Threads via `platformConfigured()`.

---

## Phase scoreboard (foundation wave)

| Phase | Goal | State |
|---|---|---|
| **A** — SMS cutover + thin engagement SMS | Discord out; Twilio/Linq; worker loops; deep-link connects; A6 `send`/edit for drafted replies | ✅ **done** |
| **B** — Brand context | ICP, pains, positioning, offers, visual tokens / design memory hooks | ✅ **done** |
| **C** — Organic excellence | Context-driven visuals, carousels/stories quality, design composer + QA, model router | ✅ **done** |
| **D** — Research → strategy → plan | Research snapshots, strategy brief, plan bias, campaign controls | ✅ **done** |
| **E** — Performance analyst | Unified organic (+ paid when on) digest; make-more / boost / confirm SMS verbs | ✅ **done** |
| **F** — Meta paid ads | SMS ads connect, campaign builder, boost, spend caps, Marketing API surface | ✅ **done** |
| **G** — Video & AI gen | First-class Reels, vision caption, motion templates, Kling/Runway AI video | ✅ **done** |
| **H** — LinkedIn + TikTok outbound | SMS connect/publish; H0 aggregator spike; paperwork parallel | 🟡 **landing on this branch** (H0 **Direct** decision; platform types + adapters in flight) |
| **I** — Engagement → light CRM | Reply-verb polish, lead card, thin Zapier/Make webhook, toggles | 📋 **scoped only** — [`PHASE_I_CRM_SCOPE.md`](PHASE_I_CRM_SCOPE.md) |

**Cross-cutting (X1–X4):** approvals absolute; quiet hours via `isDaytime` (8am–7pm); `platformConfigured()` mock fallbacks; cohort go-live still gated on Meta App Review.

---

## ✅ Done (built and working)

**Outbound loop**
- Photo → on-brand caption → approve/edit/reject in-thread → publish (`processInbound.ts`).
- Brand-voice learning; edits fold into the voice profile (`applyCorrection.ts`).
- Smart scheduler: per-platform windows, daily caps, spacing, pillar pins (`scheduler.ts`).
- Pillars + photo auto-classification, gap-fill filler, conversational campaigns.
- AI image editing + context-driven design composer / Design QA (Phase C).
- Formats: feed / carousel / story / **reel** with explicit commands.
- IG mockup preview on every draft (`mockup.ts`).

**Inbound engagement (Phase A engine + A6 SMS)**
- Policy engine: classify → auto-reply / draft / escalate / spam-hide / lead hand-off (`engagement.ts`, `engagementLoop.ts`).
- Meta webhook ingestion into `interactions`.
- Thin SMS approve path: `"send"` → `sendLatestDraft`; edit verbs → `editLatestDraft` when no pending post.

**Live publishing engine**
- Real Meta implementation: IG feed/carousel/story/reels, FB Page, engagement pull, comment/DM replies, spam-hide (`graph/live.ts`). Needs only real tokens + App Review for Live clients.

> **Google Business Profile — DESCOPED & REMOVED.** Not social media. Migration `0024_drop_google.sql`.

**Brand / strategy / analyst / ads / video (B–G)**
- ICP, pain points, positioning, offers; research snapshots + strategy brief SMS.
- Performance digest on SMS; paid metrics join when ads enabled.
- Meta ads: feature toggles, spend caps, boost + campaign builder, Marketing API types.
- Reels + client video captioning + motion edits + async AI video jobs.

**Infra & dashboard**
- Neon + migrations; Railway worker (publish + engagement + proactive loops + Linq inbound); Next.js dashboard; passwordless phone auth; `/privacy`, `/terms`, `/data-deletion`.
- User-facing rename to **Kip** done.
- **SMS cutover:** Discord package **removed**; `MESSAGE_CHANNEL=twilio|linq` only; SMS deep-link Meta/ads connect at `/c/[token]`.

---

## 🟡 Halfway / optional / gated

| Item | Reality |
|---|---|
| Live Meta publishing | **Code complete** — confirm against first real published post (App Review screencast). |
| **X & Threads (keep decision)** | **Keep as optional destinations.** Real OAuth + live publish exist; they fall back to mock until the app is configured (`X_CLIENT_ID` / `THREADS_APP_ID`) **and** a brand connects, via `platformConfigured()`. Not descoped; not required for Wave 1 IG/FB cohort. |
| Channel end-state | **Twilio SMS primary**; **Linq** supported (`MESSAGE_CHANNEL=linq`). Discord removed. |
| Phase H LinkedIn/TikTok | **H0 decision: Direct adapters** (not Postiz) — see [`PLATFORM_AGGREGATOR_SPIKE.md`](PLATFORM_AGGREGATOR_SPIKE.md). Types / env / connect purposes landing; finish publish + SMS connect before calling H done. |
| Phase I CRM webhook | Type stub `features.crm_webhook` only — no push implementation. |

---

## 🔐 Verification & approvals (critical path — mostly not code)

| Gate | State | Notes |
|---|---|---|
| Meta — FB Login, Privacy/Terms/Data-deletion URLs, app domain | ✅ | Done |
| Meta — `instagram_content_publish` | ✅ | Active |
| Meta — **Business Verification** | ✅ **complete (2026-09-10)** | Unblocks advanced scopes |
| Meta — app icon upload | ⬜ | Use `apps/web/public/brand/kip-logo-1024.png` |
| Meta — add `pages_manage_posts` + trim scopes | ⬜ | Unblocked by verification |
| Meta — screencast + App Review submission | ⬜ **next up** | Then flip app to Live |
| Twilio AU sender registration | ⬜ | Needed for reliable AU SMS |
| **X1 Approvals** | ✅ | Worker `hasApprovedLog` blocks publish without `approval_log.action='approved'` |
| Internal typecheck + tests | ✅ | Run `pnpm -r typecheck` / package vitest suites on this branch |

---

## Cross-cutting notes (X1–X4)

- **X1 — Approvals & audit:** Every draft / approve / edit / publish / failure writes `approval_log`. Publish loop refuses posts missing an `approved` row (`apps/worker/src/publish/assertApproved.ts`). Do not weaken this.
- **X2 — Quiet hours:** Proactive SMS (check-in, chase, digest, competitor watch) uses `isDaytime` — default **8am–7pm** local (`reengagement.ts`). See RUNBOOK.
- **X3 — Platform configured:** New platforms must use `platformConfigured(ENV)` for mock fallback — never `getServerEnv()` for that gate.
- **X4 — Cohort go-live:** Beta on Meta Testers + Twilio SMS while App Review clears; flip `GRAPH_MODE=live` only after approval.

---

## 🔲 To do (ROI order)

1. **Submit Meta App Review** (icon, scopes, screencast) → Live app.
2. **Confirm live publish** end-to-end on a real connected account.
3. **Phase H** — LinkedIn + TikTok outbound (after H0 Postiz-vs-direct spike).
4. **Phase I** — only when scheduled; follow [`PHASE_I_CRM_SCOPE.md`](PHASE_I_CRM_SCOPE.md) (no full CRM).

---

## Decisions locked (this wave)

- Discord **removed**; SMS-led product.
- X/Threads **remain optional** destinations behind `platformConfigured()`.
- Phase H0: **Direct** LinkedIn + TikTok adapters (not Postiz) — [`PLATFORM_AGGREGATOR_SPIKE.md`](PLATFORM_AGGREGATOR_SPIKE.md).
- Phase I = thin CRM webhook + SMS polish later — **not** a Kip CRM product.
- Phase H = LinkedIn/TikTok **outbound** first; inbound engagement deferred.
