# Stripe setup — what you do in Dashboard + Vercel

Catalog, Checkout, webhooks, and operator billing are in the app. This page is only the
external steps (API keys, Customer Portal, invoices).

**Right now we are on sandbox.** Use the **Kip ai test** Stripe account. Do not put live
keys on Preview. The production live webhook is disabled until go-live.

There are two Stripe *accounts*, not just a Test/Live toggle on one account:

| Account | Use for |
|---|---|
| **Kip ai test** | Preview, local, first Checkout smoke |
| **Kip Ai** | Production only, after sandbox works |

Do not open **Kip Ai**, flip the Dashboard to Test mode, and copy those keys — that test
mode is a different catalog. We never created Prices there.

---

## A. Hook up sandbox (do this now)

### 1. Copy the test secret key

1. Open [Stripe Dashboard](https://dashboard.stripe.com) and switch the account picker to **Kip ai test**.
2. [Developers → API keys](https://dashboard.stripe.com/test/apikeys)
3. Reveal **Secret key** (`sk_test_…`). Leave Publishable key unused (hosted Checkout does not need it in Vercel).

### 2. Confirm the test webhook

Already created: **Kip billing (preview / test)**  
`we_1UFqaRHVCUBRaxA22n06qn4w`  
URL: `https://pulse-ai-git-cursor-stripe-payment-i-c8a7ea-william08s-projects.vercel.app/api/webhooks/billing`

Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`.

Signing secret (`whsec_…`) was shown once when the endpoint was created. If you no longer have it: open that endpoint → **Reveal** / roll the signing secret.

### 3. Paste both into Vercel (Preview + Development only)

[Vercel → pulse-ai → Environment Variables](https://vercel.com/william08s-projects/pulse-ai/settings/environment-variables)

| Name | Value | Environments |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…` from Kip ai test | **Preview**, **Development** — not Production |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` for the preview webhook | **Preview**, **Development** — not Production |

Leave Production empty for now. Preview refuses `sk_live_` keys unless `STRIPE_ALLOW_LIVE=true`.

You do **not** need `STRIPE_PRICE_*`. Checkout loads Prices by lookup key (`kip_pro_month` / `kip_pro_year` / `kip_max_month` / `kip_max_year`).

Redeploy the Preview deployment after saving (Deployments → ⋯ → Redeploy).

### 3b. Enable DATABASE_URL on Preview (this is what caused the white screen)

Neon often injects `DATABASE_URL` for **Production only**. Preview then throws `DATABASE_URL is required for the database pool` on signup (digest `849919544`).

1. [Environment Variables](https://vercel.com/william08s-projects/pulse-ai/settings/environment-variables)
2. Open `DATABASE_URL` → enable **Preview** (and Development). Use the same Production connection string for this smoke test.
3. Also enable Preview for `AUTH_SECRET`, `TOKEN_ENCRYPTION_KEY`, `APP_BASE_URL`, and the Twilio vars (OTP SMS).
4. Redeploy Preview.

Stripe keys alone are not enough — signup talks to Postgres before Checkout.

### 4. Customer Portal (test account)

1. Stay on **Kip ai test**.
2. [Settings → Billing → Customer portal](https://dashboard.stripe.com/test/settings/billing/portal)
3. Enable the portal if it is off.
4. **Products:** customers can switch among the four Kip Prices (Pro/Max × month/year).
5. **Cancellations:** cancel at period end (not immediately).
6. Save.

The app opens this portal from `/app/billing`. Until this is saved, “Open billing portal” can fail even when Checkout works.

### 5. Smoke test on Preview

Preview: https://pulse-ai-git-cursor-stripe-payment-i-c8a7ea-william08s-projects.vercel.app

1. Sign up (or log in) with a brand that has not paid.
2. `/payment` should show **Stripe test mode**.
3. Choose Pro monthly → Checkout.
4. Pay with `4242 4242 4242 4242`, any future expiry, any CVC, any AU postcode.
5. Land on `/payment/success`, then onboarding SMS (or `/check-messages`).
6. Stripe → **Kip ai test** → Developers → Webhooks → the preview endpoint should show `checkout.session.completed` (2xx).
7. `/app/billing` → Open billing portal → confirm cancel-at-period-end.

Failed payment retry: use Stripe’s test decline cards later if you want `past_due` (access stays on).

---

## B. Go live (only after sandbox smoke is green)

Do not do this until you have taken a test $79 Checkout all the way through.

1. **Kip Ai** (live account): KYC + bank payouts complete.
2. [Customer portal](https://dashboard.stripe.com/settings/billing/portal) — same four Prices, cancel at period end.
3. Invoice branding: legal name + ABN. Customer emails for receipts and failed payments on. Do **not** add exclusive GST on top of the GST-inclusive list prices.
4. Re-enable the live webhook `we_1UFqcEHq2ejcSwebHfq1FdZz` (currently **disabled**). URL: `https://pulse-ai-william08s-projects.vercel.app/api/webhooks/billing`. If the production domain changes, update that URL first.
5. Vercel **Production** only: `STRIPE_SECRET_KEY` = `sk_live_…` from Kip Ai, `STRIPE_WEBHOOK_SECRET` = live `whsec_…`.
6. One real $79 charge: webhook → `facts.payment.status=active` → one onboarding SMS → receipt → portal cancel-at-period-end.

Keep `PLAN_ENFORCEMENT` unset/false.

---

## If Checkout says payments aren’t available

- Preview env vars missing, or still on an old deploy.
- `STRIPE_SECRET_KEY` is `sk_live_` on Preview (blocked).
- You copied keys from **Kip Ai** Test mode instead of the **Kip ai test** account (lookup keys will 404).

## If signup is a white screen / “Application error”

Preview is missing `DATABASE_URL`. Enable it for Preview (same value as Production) and redeploy. See §3b.
