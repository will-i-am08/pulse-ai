# Pulse — product spec & roadmap

**The promise:** a small business owner sends a photo (or nothing at all) and never thinks about social media again. Pulse runs the whole presence — posting, replies, reviews, leads — on autopilot, on brand, in one text thread.

This spec captures the target product and the phased build to get there. Decisions below were settled in the scoping sessions; the roadmap section is the ordered plan.

---

## Where we are (built)

The **outbound** half is done:

- SMS/Discord agent: text a photo → drafted on-brand caption → approve → publish (Instagram live; Facebook pending App Review).
- Brand-voice learning (corrections fold into the voice profile).
- AI image editing (styling, magazine tiles, quote cards) + follow-up "make the photo brighter" re-edits.
- Content **pillars** with photo auto-classification.
- **Smart scheduler**: per-platform windows + guardrails (daily cap, spacing, no back-to-back same pillar, weekly cadence).
- Per-pillar **hold-window autopilot**.
- Proactive **gap-fill** (nudges + generated filler).
- Conversational **campaigns**.
- Dashboard **content calendar**.
- **Self-serve Meta linking** (Facebook Login for Business → durable encrypted Page token).

The **inbound** half — and everything that makes it truly hands-off — is what this spec adds.

---

## Settled decisions

| Area | Decision |
| --- | --- |
| Inbound engagement | Handle **everything at once** — comments, DMs, mentions, reviews across IG/FB/Google. |
| Reply policy | **Auto** safe (thanks, emoji, simple FAQs) · **draft** judgment calls · **escalate** complaints/negative/hot-leads immediately. |
| Leads | **Qualify, then hand off** — agent answers facts, hands a real lead to the owner in-thread with a one-liner. |
| Next platform | **Google Business Profile** — posts **and** review replies. |
| Content supply | **Connect Google Photos/Drive** + **generate to fill** (honest graphics **and** AI photo-style shots when no real photo exists). |
| Business facts | **Structured profile at onboarding**, pre-filled from website + Google listing; owner updates by telling the agent. |
| Packaging | **One all-in plan, per-capability toggles** (autopilot, auto-replies, GBP, leads, ads). No tiers. |
| Response speed | **Near-real-time** (webhooks/eventing), not batched. |
| Touchpoint | **One thread**, dashboard optional — photos, approvals, escalations, leads, recaps all in the single chat thread. |
| AI-visual honesty | AI photo-style filler allowed; never fabricate a specific claim (fake award, fake testimonial). |

---

## The four gap areas

### 1. Inbound engagement (the other half)

The agent watches and works inbound in near-real-time, then routes by a three-way policy.

- **Sources:** IG comments · IG DMs · IG mentions/tags · FB Page comments · FB Page messages · Google reviews · FB reviews/recommendations.
- **Policy engine** (per interaction): classify into a **bucket** (sales lead · customer support · general engagement · spam/troll) + sentiment → **auto-reply** (safe, answerable from the business profile) · **draft** (needs judgment, sent to the owner to approve) · **escalate** (complaint, negative review, or hot lead → straight to the owner).
- **Spam/troll:** auto-hide (or delete) obvious spam and troll comments to protect the feed — never drafted to the owner.
- **Sentiment-spike detection:** watch for a *surge* of negativity (not just one bad comment) — a possible PR issue — and escalate it urgently, flagged as such.
- **Leads:** detect buying/booking intent → answer the obvious (hours, price, booking link) → hand off to the owner in-thread with a summary. Never tries to close a sale on its own.
- **Reviews:** draft/handle replies to Google + Facebook reviews; negative reviews always escalate.

**Data model (new):**
- `interactions` — `id, brand_id, platform, kind (comment|dm|mention|review), external_id, author_handle, text, sentiment, intent, status (new|auto_replied|drafted|escalated|resolved), created_at`.
- `interaction_replies` — `id, interaction_id, body, actor (agent|owner), status, external_reply_id, created_at`.

**Integrations / permissions:** Meta webhooks (IG comments/mentions, Page feed, messaging). Needs `instagram_manage_comments` (already in app), `instagram_manage_messages`, `pages_messaging`, `pages_manage_engagement`, `pages_read_engagement` (have). Google reviews via the GBP API (below).

### 2. Google Business Profile

- **Posts:** publish updates/offers/events to the Google profile — a third channel in the posting engine (extend `posts.platform` + a GBP publisher in the graph adapter).
- **Reviews:** pull Google reviews into `interactions`; draft/handle replies via the policy engine.

**Integration:** Google **Business Profile API** — a *separate* Google Cloud project + OAuth + Google's own API-access approval (Google gates GBP API access; request early). Store the Google token encrypted alongside the Meta tokens.

### 3. Content supply (never runs dry)

- **Connect a Google Photos album or Drive folder** (Google OAuth). Agent polls for new media and imports it into the queue, auto-classified into a pillar.
- **Generate to fill** when a slot is starving and no real photo exists: honest graphics (quote/tip/offer cards — built) **and** AI photo-style imagery via Replicate. Generated content still respects the "always held for approval" rule from the posting engine.
- **Repurpose existing assets** *(added from external review):* point the agent at an existing blog post, website page, menu, or a YouTube/video link and it atomises it into a week of platform-specific posts. Big effort-killer for owners who already have content sitting somewhere.
- **Carousels** *(added):* support multi-slide posts (tips, before/after, menu, step-by-step) as a content type — high-performing and cheap to generate on-brand from the visual profile.

**Data model:** `content_sources` — `id, brand_id, kind (google_photos|drive), external_ref, cursor, encrypted_token, last_synced_at`.

### 4. Business-facts profile (powers replies + posts)

A living profile captured at onboarding and editable by chat:

- Hours, address/service area, services + prices (or menu), booking/enquiry link, policies (delivery, returns, cancellations), a short FAQ list, key differentiators.
- **Pre-fill** by reading their website + Google listing during onboarding, then confirm with the owner.

**Data model:** extend `brands` with `facts jsonb` (or a `business_profile` table). This is the source of truth for auto-FAQ replies and Google/other posts.

**Visual identity** *(added from external review):* alongside the facts, store a per-brand visual profile — brand colours, fonts, preferred aspect ratios, and a one-line aesthetic note — so generated tiles, carousels and graphics come out on-brand instead of using fixed defaults. Pre-fill from the website (logo/colour extraction) at onboarding.

---

## Experience & packaging

- **One thread.** Everything reaches the owner in their single channel (Discord now; SMS when the Twilio number lands): drafts to approve, escalations, lead summaries, and a periodic recap. The dashboard/calendar stays optional.
- **Near-real-time.** Webhook-driven; the agent reacts within minutes, not on a batch.
- **All-in, toggled.** One price, every capability included. Per-brand feature toggles (`brands.features jsonb`): `autopilot`, `auto_replies`, `gbp`, `lead_handoff`, `ads`. Levels (presence → engagement → results → ads) are switches, not tiers.

---

## Roadmap (ROI order)

| Phase | Ships | Depends on |
| --- | --- | --- |
| **A — Inbound engagement + business profile** | Business-facts profile (onboarding + chat-editable, pre-filled from site/Google) · IG/FB comment/DM/mention webhooks · auto/draft/escalate policy engine · lead qualify + hand-off · reply auditing | Meta scopes (`instagram_manage_comments/messages`, `pages_messaging/manage_engagement`) → **App Review + Business Verification** |
| **B — Google Business Profile** | Connect GBP · post to Google · pull + reply to Google reviews (into the policy engine) | Google **GBP API** access approval + OAuth (separate track — start early) |
| **C — Content sourcing** | Google Photos/Drive connect + auto-pull + auto-classify · generation-to-fill (graphics + AI photo-style) | Google OAuth (Photos/Drive scopes) |
| **D — Growth & learning** | Boost top posts / simple ads on an owner-set budget · results tracking · **closed-loop learning** (weekly top-decile vs bottom-decile → agent suggests shifting timing/format/topic) · **actionable digests** (one insight + one recommendation, e.g. "carousels beat static 3:1 — want more?") · optional **outbound-engagement** and **seasonal/local-event** toggles | Ads permissions + App Review; billing on the owner's ad account |

**Acceptance snapshot per phase:**
- **A:** a comment/DM on a connected account gets an appropriate auto-reply, draft, or escalation within minutes; a booking DM produces a one-line lead hand-off in the owner's thread.
- **B:** an offer publishes to Google; a new Google review appears in the thread with a drafted reply.
- **C:** the owner drops photos in a Google album and they appear, sorted, on the calendar without a text; a starved slot fills with generated content held for approval.
- **D:** the owner flips "ads" on with a weekly budget and the agent boosts the best-performing post within that cap.

---

## Approvals & gating (the real critical path)

Almost none of this is code-blocked — it's **approval-blocked**, on the same track as the current push:

1. **Meta Business Verification** — in progress. Unlocks advanced permissions.
2. **Meta App Review** — must add and justify each new scope (comments, messaging, engagement, ads) with screencasts. Bigger submission than posting alone.
3. **Google Business Profile API access** — a separate Google review process; **request it as soon as Phase B starts** (it's often the long pole).

Sequence the approval requests to match the roadmap so nothing waits on paperwork it could have started weeks earlier.

---

## Platform strategy: build vs buy *(from external review)*

For the **long tail of platforms** (TikTok, LinkedIn, Pinterest, Threads, etc.), consider a **unified publishing layer** — e.g. **Postiz** (28+ channels; an integration is already available to us) or similar (Buffer/Metricool) — instead of hand-building and App-Reviewing each one.

- **Buy (aggregator):** ships many channels fast, sidesteps a lot of per-platform review/verification, less maintenance. Trade-offs: a dependency + its cost, thinner control over each platform's native features, and inbound engagement usually still needs direct API access.
- **Build (direct API):** full control and margin, but every platform is its own integration + approval slog.

**Recommendation:** stay **direct** for the core surfaces where we own the experience and the inbound loop (IG, FB, Google), and evaluate an aggregator for the *outbound-only* long tail once those are proven. Don't hand-build TikTok/LinkedIn from scratch before checking the aggregator maths.

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
- Exact escalation format + quiet hours (near-real-time shouldn't mean 2am pings).
- Sentiment/intent classifier thresholds (tune auto vs draft to minimise both owner load and bad auto-replies).
- Whether AI photo-style filler carries any subtle "created by" treatment.
- Ads budget guardrails and spend approval UX for Phase D.
