# Kip — build status snapshot

_Living snapshot of what's built, what's gated, and what's next. Audited 2026-09-09 against the source, not the intentions. Pairs with [`ROADMAP.md`](ROADMAP.md) (strategy) and [`META_APP_REVIEW.md`](META_APP_REVIEW.md) (approvals)._

**One-line verdict:** the engine is built and far ahead of its own docs. The project is **approval-blocked, not code-blocked** — Meta and Google haven't stamped the permission slips, so real clients can't connect live accounts yet. Highest-ROI work now is unblocking revenue, not writing more features.

- ~14,500 lines of TypeScript, clean pnpm monorepo, 16 test files, audit-first (nothing publishes without a logged `approved` action).
- All feature branches merged into `main`; `main` == `origin/main`. No stranded half-work.
- Stack: **Neon** Postgres · Vercel (dashboard + webhooks) · Railway (worker) · Anthropic (drafting) · Meta Graph (mock→live) · GBP API.

---

## ✅ Done (built and working)

**Outbound loop**
- Photo → on-brand caption → approve/edit/reject in-thread → publish (`processInbound.ts`).
- Brand-voice learning; edits fold into the voice profile (`applyCorrection.ts`).
- Smart scheduler: per-platform windows, daily caps, spacing, no back-to-back same pillar, pillar schedule pins (`scheduler.ts`).
- Pillars + photo auto-classification, gap-fill filler, conversational campaigns.
- AI image editing (tiles, quote/tip cards, re-edits) (`imaging.ts`).
- Formats: feed / carousel / story with explicit commands (`formats.ts`).
- IG mockup preview on every draft (`mockup.ts`).

**Inbound engagement (Phase A)** — _built, contrary to the old roadmap_
- Policy engine: classify → auto-reply / draft / escalate / spam-hide / lead hand-off + sentiment-spike detection (`engagement.ts`, `engagementLoop.ts`).
- Meta webhook ingestion into `interactions` (`webhooks/meta/route.ts`).

**Live publishing engine**
- Real Meta implementation: IG feed/carousel/story/reels, FB Page, engagement pull, comment/DM replies, spam-hide (`graph/live.ts`). Needs only real tokens.

> **Google Business Profile (was Phase B) — DESCOPED & REMOVED (2026-09-09).**
> GBP isn't social media, so posting to Google and Google-review sync were cut.
> The code has been removed: `shared/google.ts`, `reviewSync.ts`, `connect/google/*`,
> `actions/google.ts`, the `google` branch of `live.ts`, the `google` platform +
> Brand GBP fields, and the dashboard connect flow are all gone. Migration
> `0024_drop_google.sql` drops the GBP columns + `content_sources` table (prod-safe).
> Typecheck + all 110 tests pass after removal.

**Growth/learning (Phase D, partial)**
- Performance analysis (`insights.ts`), competitor intel + weekly watch (`competitors.ts`), niche research → content plan (`nichePlan.ts`), URL repurposing (`repurpose.ts`).

**Infra & dashboard**
- Neon + 23 migrations; Railway worker (publish + trigger + engagement + review loops, overlap-guarded, graceful shutdown); Next.js dashboard (brands, approvals, voice, history, content-plan, feed); password-gated operator auth; `/privacy`, `/terms`, `/data-deletion`.
- User-facing rename to **Kip** done.

---

## 🟡 Halfway (built-but-gated, or scaffolded-not-wired)

| Item | Reality |
|---|---|
| Live Meta publishing | Code complete; `TODO(live)` on permalink fetch + FB video routing, unverifiable without a real token. **Done-pending-token.** |
| X & Threads | Deliberately **mock/fake-feed only** — `live.ts` routes them to the mock adapter. Placeholders, not integrations. |
| Closed-loop learning digest (Phase D) | `analyzePerformance` exists; not wired to a weekly trigger. |
| Channel end-state | Discord live now; Twilio built + tested (not primary); **Linq** (end state) sandbox only. |
| ~~Google Photos/Drive auto-import~~ | **Cut** with the Google descope. Migrations `0012`/`0015` (`content_sources`) are now dead schema. |

---

## 🔐 Verification & approvals (the real critical path — none of it is code)

| Gate | State | Notes |
|---|---|---|
| Meta — FB Login, Privacy/Terms/Data-deletion URLs, app domain | ✅ | Done |
| Meta — `instagram_content_publish` | ✅ | Active |
| Meta — app icon upload | ⬜ | Use `apps/web/public/brand/kip-logo-1024.png` |
| Meta — **Business Verification** | ⬜ **not started** | Long pole. Gates `pages_manage_posts` + all advanced inbound scopes |
| Meta — trim unused ads/marketing scopes to the 7 needed | ⬜ | Cleaner, faster review |
| Meta — screencast + App Review submission | ⬜ | Blocked behind verification |
| ~~Google GBP API access~~ | ✂️ **descoped** | Google cut — not social media |
| Twilio AU sender registration | ⬜ | Needed when moving off Discord to SMS |
| Internal typecheck + tests | ✅ green (2026-09-09) | `pnpm -r typecheck` clean across all 8 packages; **110 tests pass** (graph 6, orchestrator 72, gateway 14, worker 18) |

---

## ✅ Done 2026-09-09

- **Removed all Google code** (descoped — not social media): `shared/google.ts`, `reviewSync.ts`, `connect/google/*`, `actions/google.ts`, the `google` platform + Brand GBP fields, dashboard connect flow, worker review-sync loop, and the GBP doc. Migration `0024_drop_google.sql` drops the columns + `content_sources` table (prod-safe guard on the platform check). Typecheck + 110 tests green.
- **Fixed stale Supabase→Neon docs**: `RUNBOOK.md` and `BUILD_CONTRACTS.md` now describe Neon Postgres, the `/api/media/[id]` storage, and the single-operator password gate; `MIGRATION_CONTRACTS.md` marked completed/historical.

## 🔲 To do

1. **Ads / boost-top-posts** (Phase D) — not started.
2. **X/Threads** real integrations — currently faked.
3. **Wire the closed-loop learning digest** to a weekly trigger.

---

## Next actions (ROI order)

The build team has run out ahead of the paperwork. Extra features earn nothing until a client can connect a real account, so unblock revenue first.

| # | Move | Why first |
|---|---|---|
| 1 | **Start Meta Business Verification + upload app icon** | The single gate in front of every real client. Weeks of external wait. Zero code. |
| 2 | **Run the beta on Meta Testers + Discord** | Testers need no review — onboard a paying cohort today against the built engine. Proof + cash while queues clear. |
| 3 | Trim Meta scopes → 7, record screencast, submit App Review | Gets to a **Live** app any client can connect. |
| 4 | (Post-approval) learning digest → ads | Real feature work, sequenced after the thing that lets clients pay. _(Google removal + Supabase→Neon docs — done 2026-09-09.)_ |
