# Kip — build status snapshot

_Living snapshot of what's built, what's gated, and what's next. Audited 2026-09-09 against the source, not the intentions. Pairs with [`ROADMAP.md`](ROADMAP.md) (strategy) and [`META_APP_REVIEW.md`](META_APP_REVIEW.md) (approvals)._

**One-line verdict:** the engine is built and far ahead of its own docs. The project is **approval-blocked, not code-blocked** — but the biggest gate just cleared: **Meta Business Verification is complete (2026-09-10)**. The only thing between the built engine and real clients is now the **Meta App Review submission** (then flip to Live). Highest-ROI work is finishing that submission, not writing more features.

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
| Live Meta publishing | **Code complete** — the `TODO(live)` gaps (IG permalink, FB video routing, FB reach) are now implemented to Meta's documented shapes, best-effort wrapped so they degrade rather than fail. Only remaining step is confirming against the **first real published post** (e.g. the App Review screencast). |
| X & Threads | **Real integrations built** — OAuth connect + live publish for both (X via API v2, Threads via Meta). They fall back to the mock feed only until the app is configured (`X_CLIENT_ID` / `THREADS_APP_ID`) and a brand connects an account, via the `platformConfigured()` guard. |
| Closed-loop learning digest (Phase D) | `analyzePerformance` exists; not wired to a weekly trigger. |
| Channel end-state | Discord live now; Twilio built + tested (not primary); **Linq** (end state) sandbox only. |
| ~~Google Photos/Drive auto-import~~ | **Cut** with the Google descope. Migrations `0012`/`0015` (`content_sources`) are now dead schema. |

---

## 🔐 Verification & approvals (the real critical path — none of it is code)

| Gate | State | Notes |
|---|---|---|
| Meta — FB Login, Privacy/Terms/Data-deletion URLs, app domain | ✅ | Done |
| Meta — `instagram_content_publish` | ✅ | Active |
| Meta — **Business Verification** | ✅ **complete & verified (2026-09-10)** | The long pole — now cleared. Unblocks `pages_manage_posts` + advanced scopes |
| Meta — app icon upload | ⬜ | Use `apps/web/public/brand/kip-logo-1024.png` |
| Meta — add `pages_manage_posts` + trim to the 7 scopes | ⬜ | Now unblocked by verification |
| Meta — screencast + App Review submission | ⬜ **next up** | No longer blocked — then flip app to Live |
| ~~Google GBP API access~~ | ✂️ **descoped** | Google cut — not social media |
| Twilio AU sender registration | ⬜ | Needed when moving off Discord to SMS |
| Internal typecheck + tests | ✅ green (2026-09-09) | `pnpm -r typecheck` clean across all 8 packages; **110 tests pass** (graph 6, orchestrator 72, gateway 14, worker 18) |

---

## ✅ Done 2026-09-10

- **Finished the live Meta Graph paths**: the three `TODO(live)` gaps are implemented — IG permalink fetch, FB video routing (`/videos`) vs photo/text, and FB reach via post insights. All best-effort wrapped so a field mismatch degrades to `null`/`0` rather than failing the publish/report. Confirm on the first real post.
- **Passwordless phone login** (OTP through the agent thread), **X + Threads live integrations**, and the **`platformConfigured()` mock-fallback guard** (ends the recurring env-validation bug) all landed. **Meta Business Verification complete** — App Review submission is the remaining Meta gate.

## ✅ Done 2026-09-09

- **Removed all Google code** (descoped — not social media): `shared/google.ts`, `reviewSync.ts`, `connect/google/*`, `actions/google.ts`, the `google` platform + Brand GBP fields, dashboard connect flow, worker review-sync loop, and the GBP doc. Migration `0024_drop_google.sql` drops the columns + `content_sources` table (prod-safe guard on the platform check). Typecheck + 110 tests green.
- **Fixed stale Supabase→Neon docs**: `RUNBOOK.md` and `BUILD_CONTRACTS.md` now describe Neon Postgres, the `/api/media/[id]` storage, and the single-operator password gate; `MIGRATION_CONTRACTS.md` marked completed/historical.

## 🔲 To do

1. **Ads / boost-top-posts** (Phase D) — not started.
2. **Wire the closed-loop learning digest** to a weekly trigger.
3. **Confirm live publish end-to-end** against a real connected account (permalink/reach fields, FB video) — one real post during the App Review screencast covers it.

---

## Next actions (ROI order)

The build team has run out ahead of the paperwork. Extra features earn nothing until a client can connect a real account, so unblock revenue first.

| # | Move | Why first |
|---|---|---|
| 1 | **Submit Meta App Review** — upload app icon, add `pages_manage_posts`, trim to 7 scopes, record screencast, submit | Business Verification is ✅ done, so this is unblocked. It's the last gate before a **Live** app any client can connect. |
| 2 | **Run the beta on Meta Testers + Discord** | Testers need no review — onboard a paying cohort today against the built engine while App Review clears. Proof + cash now. |
| 3 | **On approval → flip app to Live**, set `GRAPH_MODE=live` with real tokens | Real posting to IG + FB goes hot; first real client onboards end-to-end. |
| 4 | (Post-approval) learning digest → ads | Real feature work, sequenced after the thing that lets clients pay. _(Google removal + Supabase→Neon docs — done 2026-09-09.)_ |
