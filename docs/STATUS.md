# Kip — build status snapshot

_Living snapshot of what's built, what's gated, and what's next. Audited 2026-09-11 against the source. Pairs with [`ROADMAP.md`](ROADMAP.md), [`PHASE_I_CRM_SCOPE.md`](PHASE_I_CRM_SCOPE.md), and [`META_APP_REVIEW.md`](META_APP_REVIEW.md)._

**One-line verdict:** Phases **A–I are built** on this branch (I = thin CRM webhook + SMS lead polish; **not** a full CRM). The project remains **approval-blocked for Live Meta clients** — Business Verification is ✅; App Review submission is the remaining gate. Highest-ROI non-code work is finishing that submission.

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
| **H** — LinkedIn + TikTok outbound | SMS connect/publish; H0 aggregator spike; paperwork parallel | ✅ **Direct adapters** (H0–H6) — mock SMS connect + publish; live gated on app creds + `TIKTOK_AUDIT_PASSED` |
| **I** — Engagement → light CRM | Reply-verb polish, lead card, thin Zapier/Make webhook, toggles | ✅ **done** (thin) — [`PHASE_I_CRM_SCOPE.md`](PHASE_I_CRM_SCOPE.md) |
| **V1** — Photo → 3 variant picks | MMS park/resolve 1/2/3; faithful enhance; `variants.ts` | ✅ **done** |
| **V2** — Niche look packs | `lookPacks/` studios + onboarding seed + SMS change-look | ✅ **done** |
| **V3** — Instant demo | `/d/new`, `/d/[slug]`, `demo_sessions` migration | ✅ **done** |
| **V4** — Weekly creative refresh | Worker loop + library photo → variant park | ✅ **done** |

**Cross-cutting (X1–X4):** approvals absolute; quiet hours via `isDaytime` (8am–7pm); `platformConfigured()` mock fallbacks; cohort go-live still gated on Meta App Review.

---

## ✅ Done (built and working)

**Outbound loop**
- Photo → on-brand caption → approve/edit/reject in-thread → publish (`processInbound.ts`).
- Brand-voice learning; edits fold into the voice profile (`applyCorrection.ts`).
- Smart scheduler: per-platform windows, daily caps, spacing, pillar pins (`scheduler.ts`).
- Pillars + photo auto-classification, gap-fill filler, conversational campaigns.
- AI image editing + context-driven design composer / Design QA (Phase C).
- **V1–V2:** single photo → three niche look variants → reply `1`/`2`/`3` (or original/skip); look packs (café, salon, gym, tradie, food, retail).
- **V3:** public website demo at `/d/new` → `/d/[slug]` (48h samples).
- **V4:** weekly creative-refresh worker when the feed goes stale.
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
| Phase H LinkedIn/TikTok | **Done (code):** Direct adapters (not Postiz) — [`PLATFORM_AGGREGATOR_SPIKE.md`](PLATFORM_AGGREGATOR_SPIKE.md). SMS deep-link connect (Company Page name confirm; TikTok privacy/music consent); mock + live publish shapes; multi-dest fan-out isolation; public TikTok live gated by `TIKTOK_AUDIT_PASSED`. |
| Phase I CRM webhook | ✅ Thin push + `crm_push_log`; SMS set/send; optional email fallback |

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
3. **LinkedIn / TikTok live apps** — connect real `LINKEDIN_CLIENT_ID` / `TIKTOK_CLIENT_KEY`; set `TIKTOK_AUDIT_PASSED` only after Content Posting audit.
4. **Live cohort** — Twilio AU sender + Meta Live after App Review.

---

## Destination links (booking URLs — not SMS `/c/` deep links)

**Destination / booking links** are confirmed public URLs Kip discovers from the brand website, SMS-confirms with the owner, then uses in captions, Stories CTAs, engagement replies, and ad click-throughs. They are **not** the SMS connect deep links at `/c/[token]`.

| Surface | Behavior |
|---|---|
| Discovery | Crawl homepage + `/book`-style paths; rank Calendly/Acuity/etc.; always SMS “Is this the right link?” before save |
| Storage | Writes both `facts.booking_link` and `offers.booking_link`; pending confirm under `facts.pending_destination_link` |
| IG feed / Reels | **No URL in caption** — soft CTA (“Comment LINK…”) + `posts.link_offer`; Meta **private reply** DMs the URL once per comment |
| IG Stories | Content Publishing API **cannot** attach link stickers — bake “DM/comment for the link” into creative + same `link_offer` fulfillment; owner may add a sticker manually in the IG app |
| Facebook / X / Threads | May include confirmed URL in caption when the platform allows clickable links |
| LinkedIn | Prefer comment/DM CTA (bio mention OK as secondary); inbound auto-send deferred until LinkedIn engagement ingest |
| Ads | Marketing API `link` prefers confirmed booking URL; preview SMS shows destination; `BOOK_NOW` when booking used |

Code: `packages/orchestrator/src/destinationLinks.ts`, migration `db/migrations/0043_destination_links.sql`, `graph.privateReply`.

---

## Decisions locked (this wave)

- Discord **removed**; SMS-led product.
- X/Threads **remain optional** destinations behind `platformConfigured()`.
- Phase H0: **Direct** LinkedIn + TikTok adapters (not Postiz) — [`PLATFORM_AGGREGATOR_SPIKE.md`](PLATFORM_AGGREGATOR_SPIKE.md).
- Phase I = thin CRM webhook + SMS polish — **not** a Kip CRM product.
- Phase H = LinkedIn/TikTok **outbound** first; inbound engagement deferred.
