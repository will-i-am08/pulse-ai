# Kip — product spec & roadmap

**The promise:** a small business owner sends a photo (or nothing at all) and never thinks about social media again. Kip runs the whole presence — posting, replies, leads — on autopilot, on brand, in one text thread.

This spec captures the target product and the phased build. **Authoritative build state:** [`STATUS.md`](STATUS.md). Phase I CRM (thin webhook): [`PHASE_I_CRM_SCOPE.md`](PHASE_I_CRM_SCOPE.md).

---

## Where we are (built)

> **Status note (audited 2026-09-11):** foundation Phases **A–G are built** on the
> Kip foundation branch. **Discord is removed** — channel is SMS only
> (`MESSAGE_CHANNEL=twilio|linq`). Google Business Profile remains **descoped**.
> **Phase H** (LinkedIn + TikTok outbound) and **Phase I** (thin CRM webhook +
> engagement polish) are built — do not expand I into a full CRM.
> Live client connect is still **Meta App Review–gated**. See STATUS for the
> phase scoreboard.

**Done in code (high level):**

- SMS agent (Twilio primary, Linq end-state): photo → draft → approve → publish; deep-link connects (`/c/[token]`).
- Destination / booking links (separate from connect deep links): discover → SMS confirm → platform-safe caption/Story CTA → Meta private-reply fulfillment; ads prefer confirmed booking URL.
- Brand voice, ICP/offers, context-driven organic visuals, Reels + AI video, Meta paid ads + spend caps.
- Inbound engagement policy + thin A6 SMS `send`/edit for drafted replies.
- Performance analyst digests on SMS; optional X/Threads behind `platformConfigured()`.

**Next:** Meta App Review → Live cohort.

---

## Settled decisions

| Area | Decision |
| --- | --- |
| Inbound engagement | Handle **everything at once** — comments, DMs, mentions, reviews across IG/FB. |
| Reply policy | **Auto** safe (thanks, emoji, simple FAQs) · **draft** judgment calls · **escalate** complaints/negative/hot-leads immediately. |
| Leads | **Qualify, then hand off** — agent answers facts, hands a real lead to the owner in-thread with a one-liner. |
| Next platform | ~~Google Business Profile~~ **descoped (2026-09-09)** — not social media. Long-tail social (TikTok/LinkedIn/Pinterest/Threads) is the growth direction instead. |
| Content supply | **Generate to fill** (honest graphics **and** AI photo-style shots when no real photo exists) + **repurpose existing content** (URL → posts). ~~Google Photos/Drive connect~~ descoped with Google. |
| Business facts | **Structured profile at onboarding**, pre-filled from the owner's website; owner updates by telling the agent. |
| Packaging | **One all-in plan, per-capability toggles** (autopilot, auto-replies, leads, ads). No tiers. |
| Response speed | **Near-real-time** (webhooks/eventing), not batched. |
| Touchpoint | **One thread**, dashboard optional — photos, approvals, escalations, leads, recaps all in the single chat thread. |
| AI-visual honesty | AI photo-style filler allowed; never fabricate a specific claim (fake award, fake testimonial). |

---

## The four gap areas

### 1. Inbound engagement (the other half)

The agent watches and works inbound in near-real-time, then routes by a three-way policy.

- **Sources:** IG comments · IG DMs · IG mentions/tags · FB Page comments · FB Page messages · FB reviews/recommendations. _(Google reviews removed with the Google descope.)_
- **Policy engine** (per interaction): classify into a **bucket** (sales lead · customer support · general engagement · spam/troll) + sentiment → **auto-reply** (safe, answerable from the business profile) · **draft** (needs judgment, sent to the owner to approve) · **escalate** (complaint, negative review, or hot lead → straight to the owner).
- **Spam/troll:** auto-hide (or delete) obvious spam and troll comments to protect the feed — never drafted to the owner.
- **Sentiment-spike detection:** watch for a *surge* of negativity (not just one bad comment) — a possible PR issue — and escalate it urgently, flagged as such.
- **Leads:** detect buying/booking intent → answer the obvious (hours, price, booking link) → hand off to the owner in-thread with a summary. Never tries to close a sale on its own.
- **Reviews:** draft/handle replies to Facebook reviews/recommendations; negative reviews always escalate.

**Data model (new):**
- `interactions` — `id, brand_id, platform, kind (comment|dm|mention|review), external_id, author_handle, text, sentiment, intent, status (new|auto_replied|drafted|escalated|resolved), created_at`.
- `interaction_replies` — `id, interaction_id, body, actor (agent|owner), status, external_reply_id, created_at`.

**Integrations / permissions:** Meta webhooks (IG comments/mentions, Page feed, messaging). Needs `instagram_manage_comments` (already in app), `instagram_manage_messages`, `pages_messaging`, `pages_manage_engagement`, `pages_read_engagement` (have).

### 2. ~~Google Business Profile~~ — DESCOPED (2026-09-09)

Cut entirely: Google isn't social media. GBP posting and review sync/reply are removed from scope; the code that was built for them is slated for deletion. This slot is intentionally left blank — the next-platform energy goes to the social long tail (TikTok/LinkedIn/Pinterest/Threads) instead. See the build-vs-buy note below.

### 3. Content supply (never runs dry)

- **Generate to fill** when a slot is starving and no real photo exists: honest graphics (quote/tip/offer cards — built) **and** AI photo-style imagery via Replicate. Generated content still respects the "always held for approval" rule from the posting engine.
- **Repurpose existing assets** *(added from external review):* point the agent at an existing blog post, website page, menu, or a YouTube/video link and it atomises it into a week of platform-specific posts. Big effort-killer for owners who already have content sitting somewhere.
- **Carousels** *(added):* support multi-slide posts (tips, before/after, menu, step-by-step) as a content type — high-performing and cheap to generate on-brand from the visual profile.

_(The `content_sources` connector data model — a Google Photos/Drive poller — is descoped with Google. The `content_sources` / `content_source_media` migrations are now dead schema pending removal.)_

### 4. Business-facts profile (powers replies + posts)

A living profile captured at onboarding and editable by chat:

- Hours, address/service area, services + prices (or menu), booking/enquiry link, policies (delivery, returns, cancellations), a short FAQ list, key differentiators.
- **Pre-fill** by reading their website during onboarding, then confirm with the owner.

**Data model:** extend `brands` with `facts jsonb` (or a `business_profile` table). This is the source of truth for auto-FAQ replies and post generation.

**Visual identity** *(added from external review):* alongside the facts, store a per-brand visual profile — brand colours, fonts, preferred aspect ratios, and a one-line aesthetic note — so generated tiles, carousels and graphics come out on-brand instead of using fixed defaults. Pre-fill from the website (logo/colour extraction) at onboarding.

---

## Experience & packaging

- **One thread.** Everything reaches the owner in their SMS/Linq thread: drafts to approve, escalations, lead summaries, and a periodic recap. The dashboard/calendar stays optional.
- **Near-real-time.** Webhook-driven; the agent reacts within minutes, not on a batch.
- **All-in, toggled.** One price, every capability included. Per-brand feature toggles (`brands.features jsonb`): `autopilot`, `auto_replies`, `lead_handoff`, `ads`. Levels (presence → engagement → results → ads) are switches, not tiers.

---

## Roadmap (ROI order)

| Phase | Ships | Build state | Depends on |
| --- | --- | --- | --- |
| **A — SMS + inbound engagement** | Discord removed · Twilio/Linq · deep-link connects · policy engine · thin A6 SMS `send`/edit | ✅ **done** | Meta messaging scopes → App Review |
| **B — Brand context** | ICP · pains · positioning · offers · visual tokens | ✅ **done** | — |
| **C — Organic excellence** | Context-driven visuals · design composer/QA · carousels/stories | ✅ **done** | — |
| **D — Research → strategy → plan** | Snapshots · strategy brief · plan bias · campaign controls | ✅ **done** | — |
| **E — Performance analyst** | Unified digest · make-more / boost / confirm SMS | ✅ **done** | Soft-links to F for live boost |
| **F — Meta paid** | Ads connect · campaign builder · spend caps · boost | ✅ **done** | Marketing API App Review |
| **G — Video + AI gen** | Reels · vision caption · motion · Kling/Runway | ✅ **done** | — |
| **H — LinkedIn + TikTok** | Outbound SMS connect/publish · H0 aggregator spike (**Direct**, not Postiz) | 🟡 **landing** — see STATUS + [`PLATFORM_AGGREGATOR_SPIKE.md`](PLATFORM_AGGREGATOR_SPIKE.md) | A + deep links; paperwork parallel |
| **I — Light CRM** | Reply polish · lead card · Zapier/Make webhook · toggles | ✅ **done** (thin) — see [`PHASE_I_CRM_SCOPE.md`](PHASE_I_CRM_SCOPE.md) | After A–H wave |
| **V1 — Photo variants** | One MMS → 3 vertical looks → reply 1/2/3 → pending draft | ✅ **done** | C imaging |
| **V2 — Niche look packs** | Café / salon / gym / tradie / food / retail studios; SMS override | ✅ **done** | V1 |
| **V3 — Instant demo** | `/d/new` + `/d/[slug]` from website; landing CTA | ✅ **done** | V2 |
| **V4 — Weekly creative refresh** | Worker parks 3 cuts from library photo when feed goes stale | ✅ **done** | V1+V2 |

**Acceptance snapshot (selected):**
- **A:** comment/DM gets auto/draft/escalate in minutes; owner can `"send"` a drafted reply from SMS.
- **F:** owner enables ads + budget; agent boosts / runs campaigns only with confirm + caps.
- **G:** client video or AI video drafts as Reels, approve-gated.
- **H:** LinkedIn Company Page + TikTok Direct Post publish from SMS (when Wave 3 ships).
- **I:** lead card + optional webhook push — **not** a Kip CRM (parked).
- **V1–V4:** photo → 3 looks → pick; look packs; public website demo; weekly refresh SMS — all approval-gated.
---

## Approvals & gating (the real critical path)

Almost none of this is code-blocked — it's **approval-blocked**, on the same track as the current push:

1. **Meta Business Verification** — ✅ **complete & verified (2026-09-10).** Advanced permissions unlocked; App Review is now the remaining Meta gate.
2. **Meta App Review** — must add and justify each new scope (comments, messaging, engagement, ads) with screencasts. Bigger submission than posting alone.
3. ~~Google Business Profile API access~~ — **descoped 2026-09-09** (Google is not social media). No longer on the critical path.
4. **Phase H paperwork** — LinkedIn Community Management + TikTok Direct Post audit (start in parallel with F/G, not after code).

Sequence the approval requests to match the roadmap so nothing waits on paperwork it could have started weeks earlier.

---

## Platform strategy: build vs buy *(from external review)*

For the **long tail of platforms** (TikTok, LinkedIn, Pinterest, Threads, etc.), consider a **unified publishing layer** — e.g. **Postiz** (28+ channels; an integration is already available to us) or similar (Buffer/Metricool) — instead of hand-building and App-Reviewing each one.

- **Buy (aggregator):** ships many channels fast, sidesteps a lot of per-platform review/verification, less maintenance. Trade-offs: a dependency + its cost, thinner control over each platform's native features, and inbound engagement usually still needs direct API access.
- **Build (direct API):** full control and margin, but every platform is its own integration + approval slog.

**Recommendation:** stay **direct** for the core surfaces where we own the experience and the inbound loop (IG, FB), and evaluate an aggregator for the *outbound-only* long tail once those are proven. Don't hand-build TikTok/LinkedIn from scratch before checking the aggregator maths.

---

## Considered and deliberately skipped

Kept out on purpose — "growth-marketer" surface that doesn't serve a time-starved local owner (revisit only if a client segment demands it):

- **Full vector-DB knowledge base** — the structured business profile + a handful of top-performing past posts as examples is enough; a RAG stack is overkill here.
- **Broad trend-scraping** (subreddits/X/RSS) + viral-potential scoring — fragile, costly, and off-brand for the audience. Replaced with lightweight **seasonal / local-event awareness**.
- **Competitor benchmarking dashboards** and **slide-deck / data-chart generation** — low ROI for small local businesses.
- **Aggressive outbound engagement** (commenting on strangers' posts to farm profile visits) — real growth lever but platform-risky; kept as an *optional, off-by-default* toggle, not core.

---

## The offer (why this sells)

Run against the Value Equation, the all-in offer is strong on every axis:

- **Dream outcome:** a busy, on-brand, well-managed social presence that also answers customers and catches leads.
- **Perceived likelihood:** the owner sees it working in their own feed and inbox, and approves what matters.
- **Time & effort:** near zero — one thread, send a photo or nothing, tap approve.

*"We run your entire social presence — posting, replies, reviews, and leads — for one price, and you never touch it"* is a stupid-to-refuse offer for a time-starved owner. The all-in-with-toggles model lets every client shape it without tier management. Pricing/offer design (guarantee, risk reversal) is a separate exercise worth doing before launch.

---

## Open items to decide at build time
- Exact escalation format (quiet hours for **proactive** SMS: 8am–7pm via `isDaytime` — see RUNBOOK).
- Sentiment/intent classifier thresholds (tune auto vs draft to minimise both owner load and bad auto-replies).
- Whether AI photo-style filler carries any subtle "created by" treatment.
- Ads budget guardrails and spend approval UX — largely shipped in Phase F; tune with first cohort.
