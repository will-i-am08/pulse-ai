# Live ops checklist — App Review, env, cohort gates

Operator runbook for taking Kip from this branch to a live Wave 1 cohort.
Pairs with [`META_APP_REVIEW.md`](META_APP_REVIEW.md), [`RUNBOOK.md`](RUNBOOK.md), [`STATUS.md`](STATUS.md).

---

## Pre-flight

- [ ] Neon migrations applied through `0039_ops_polish.sql` (`pnpm exec tsx --env-file=.env scripts/migrate.ts`)
- [ ] `TOKEN_ENCRYPTION_KEY`, `AUTH_SECRET`, `DATABASE_URL` set on **Vercel + Railway**
- [ ] `APP_BASE_URL` = public HTTPS dashboard URL
- [ ] Worker running (publish + proactive + retention loops)

---

## Env vars (operator)

| Var | Required | Notes |
|---|---|---|
| `MESSAGE_CHANNEL` | yes | `twilio` (Wave 1) or `linq` |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | Wave 1 | AU sender registration for reliable AU SMS |
| `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` | recommended | Sending + media fetch |
| `OPERATOR_PHONE` | recommended | E.164 — publish failures + ad cap breaches SMS here via `sendToOperator` |
| `LINQ_API_KEY` / `LINQ_FROM_NUMBER` / `LINQ_WEBHOOK_SECRET` | if Linq | End-state iMessage |
| `ANTHROPIC_API_KEY` | yes | Drafting |
| `DRAFT_MODEL` / `FALLBACK_MODEL` | optional | Defaults in schema |
| `GRAPH_MODE` | yes | `mock` until App Review Live; then `live` |
| `META_APP_ID` / `META_APP_SECRET` | Wave 1 live | FB Login + Graph |
| `META_WEBHOOK_VERIFY_TOKEN` | if webhooks | Engagement |
| `REPLICATE_API_TOKEN` | optional | Image edit / AI video |
| `AI_VIDEO_PRIMARY_MODEL` / `AI_VIDEO_SECONDARY_MODEL` | optional | Kling / Runway-class |
| `COST_IMAGE_USD` / `COST_VIDEO_USD` / `COST_SPECIALTY_USD` | optional | SMS cost hints (defaults `0.04` / `0.5` / `0.12`) |
| `AI_WEEKLY_SPEND_CAP_USD` | optional | Hard refuse AI video when exceeded (default `10`); tracked in `brands.facts.ai_spend` |
| `AI_VIDEO_COST_CAP_CENTS_MONTH` | optional | Monthly AI video cents cap (default `2000`) |
| `RETENTION_DAYS` | optional | Purge `design_memory` + `research_snapshots` older than N days (default `180`) |
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` | Wave 3 | Company Page |
| `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` | Wave 3 | Direct Post |
| `TIKTOK_AUDIT_PASSED` | Wave 3 live | Set `true` only after Content Posting audit |
| `X_CLIENT_ID` / `THREADS_APP_ID` (+ secrets) | optional | Destinations behind `platformConfigured()` |
| `STRIPE_SECRET_KEY` | to take payment | Live `sk_live_…` on Production; `sk_test_…` on Preview |
| `STRIPE_WEBHOOK_SECRET` | to take payment | Signing secret for `POST /api/webhooks/billing` |
| `STRIPE_PRICE_PRO_MONTH` / `_YEAR` / `STRIPE_PRICE_MAX_MONTH` / `_YEAR` | to take payment | AUD GST-inclusive Prices: $79 / $756 / $149 / $1,428 |
| `PLAN_ENFORCEMENT` | no | Leave false until Pro vs Max feature locks ship |

---

## Cohort gates

### Wave 1 — IG + FB organic (SMS)

- [ ] Meta **Business Verification** ✅ (done)
- [ ] Upload app icon (`apps/web/public/brand/kip-appicon-1024.png` — flattened, no transparency) — see META_APP_REVIEW
- [ ] App Review: Wave 1 scopes only (publishing — not ads)
- [ ] Screencast: connect → draft photo → approve → live IG + Page post
- [ ] Flip app to **Live**; set `GRAPH_MODE=live`
- [ ] Twilio AU sender registered; `OPERATOR_PHONE` receives a test failure alert
- [ ] First 3–5 brands on Meta **Testers** until Live, then open cohort
- [ ] Personal accounts: confirm ICP/ads prompts are skipped; niche plan still works

### Wave 2 — Meta paid ads

- [ ] Separate App Review for Marketing / ads scopes (see META_APP_REVIEW Wave 2)
- [ ] Brands: `"enable ads"` + `"connect ad account"` deep link
- [ ] Confirm weekly / campaign spend caps + operator SMS on cap breach
- [ ] Boost + campaign SMS flows on one test ad account in sandbox first

### Wave 3 — LinkedIn + TikTok outbound

- [ ] LinkedIn Marketing Developer Platform app + Company Page OAuth
- [ ] TikTok Content Posting API + Direct Post audit → `TIKTOK_AUDIT_PASSED=true`
- [ ] SMS `"connect LinkedIn"` / `"connect TikTok"` deep links work end-to-end
- [ ] Fan-out isolation: one destination failure does not block others

---

## Twilio / Linq smoke

1. Text photo to Kip number → draft SMS with mockup.
2. Reply `yes` → post `approved` → worker publishes (mock or live).
3. Force a publish fail → owner (LI/TT) + **operator** SMS when `OPERATOR_PHONE` set.
4. Login code: dashboard phone OTP arrives on the same channel.

---

## AI keys smoke

1. `ANTHROPIC_API_KEY` — caption draft.
2. `REPLICATE_API_TOKEN` — photo restyle (optional).
3. AI video models set → `"generate a video of …"` → SMS includes `(this may cost ~$X)`; weekly cap refuses cleanly.

---

## Data retention

- Worker weekly purge deletes `design_memory` and `research_snapshots` older than `RETENTION_DAYS` (default **180**).
- Does **not** delete posts, media, brand objects, or visual_exemplars.
- Discord brand columns dropped in migration `0038` (SMS-only).

---

## Personal vs business

| | Business | Personal |
|---|---|---|
| ICP / strategy brief / offers | ✅ | ❌ skipped with clear SMS |
| Enable ads | ✅ | ❌ refused |
| Niche content plan | ✅ | ✅ lighter |
| Organic post / Reels | ✅ | ✅ |

---

## Mock fallback (`platformConfigured`)

Every optional destination uses the same live-adapter shape:

```ts
if (!platformConfigured("linkedin" | "tiktok" | "x" | "threads") || !brand.<tokens>) {
  return new MockGraphAdapter().publish(input);
}
```

- **Never** gate that decision with `getServerEnv()` — it throws when unrelated env is missing.
- Aliases: `linkedin` → `LINKEDIN_CLIENT_ID`, `tiktok` → `TIKTOK_CLIENT_KEY`, `x` → `X_CLIENT_ID`, `threads` → `THREADS_APP_ID`.
- Brand tokens / org ids are still checked at the call site.

### X / Threads (confirmed)

- When `X_CLIENT_ID` / `THREADS_APP_ID` is unset **or** the brand has not connected, LiveGraphAdapter uses the mock feed.
- X remains `isMockOnlyPlatform` for owner-facing “did not go live” confirmation until a paid X tier is productized.
- Threads counts as live once `GRAPH_MODE=live` and a real Threads publish succeeds.

### LinkedIn / TikTok (code gates)

- LinkedIn live when `LINKEDIN_CLIENT_ID` + org tokens; Posts API text/image/multi/video with Images/Videos upload first.
- TikTok live when `TIKTOK_CLIENT_KEY` + tokens; **`TIKTOK_AUDIT_PASSED`** required for public Direct Post — otherwise privacy forced to **`SELF_ONLY`**.
- AIGC (`is_aigc`) when `style_meta.aigc` / `ai_video_job_id` / caption marks AI video.
- Clear SMS for LinkedIn admin/partner errors and TikTok caption/rate/consent caps.

### Ads

- `marketingLive`: create campaign, boost, insights spend when Meta ads token + `ad_account_id` present (no TODO stubs on happy path).
- SMS choose-ads persists `ad_account_id` via `selectAdAccountFromSmsAction`.

---

## Stripe (live charges)

- [ ] AU Stripe account in live mode, KYC + payouts
- [ ] Four AUD Prices (GST-inclusive): Pro $79/mo, Max $149/mo, Pro $756/yr, Max $1,428/yr
- [ ] Production webhook `https://<APP_BASE_URL>/api/webhooks/billing` (checkout.session.completed, customer.subscription.*, invoice.paid, invoice.payment_failed)
- [ ] Customer Portal: switch among those Prices; **cancel at period end**
- [ ] Invoice settings: legal name + ABN; customer emails (receipts + failed payments) on
- [ ] Do **not** enable Stripe Tax exclusive GST on top of list prices
- [ ] `PLAN_ENFORCEMENT` remains false
- [ ] One live $79 charge: webhook → `facts.payment.status=active` → **one** onboarding SMS → receipt email → portal cancel-at-period-end

### First-week refund playbook (manual)

Advertised: email will@jmcalder.com within 7 days of the first charge.

1. Open `/app/operator/users/<id>` → Billing.
2. Refund the latest paid invoice (full or that week’s amount). Tick **Keep access** if they should stay on (complimentary) or **Cancel subscription** if they are leaving.
3. Confirm the Stripe credit note/refund in the Dashboard.
4. If SMS already started and they are leaving, pause the brand from operator tools as usual.

Operator can also apply % discounts, change Pro/Max remotely, or mark an account complimentary without a refund.

---

## Still requiring external human approval (cannot be coded)


| Gate | Why code cannot finish it |
| --- | --- |
| Meta App Review (IG/FB publish, insights, messaging) | Meta human review of use cases / screencast |
| Meta Marketing API / ads access | Business verification + ads product access |
| LinkedIn Marketing Developer Platform / partner | LinkedIn app product approval |
| LinkedIn Company Page admin on the connecting user | Real org ACL on the customer's Page |
| TikTok Content Posting API audit | TikTok audit of Direct Post for public privacy |
| X paid API tier (if required for production write) | X developer console / billing |
| Threads “Threads API” use case on Meta app | Meta app review for Threads |
| Production OAuth redirect allowlists | Console config on each provider |
| Twilio AU sender registration | Carrier / Twilio console |
