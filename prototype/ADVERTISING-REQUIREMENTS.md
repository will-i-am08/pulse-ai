# Advertising claims — build checklist

Landing copy for **privacy / control / auditability** and **Pro / Max pricing** is aspirational until the items below ship. Do not advertise a claim until its checklist is green.

Inspired by how Lindy frames trust (private, in your control, compliance-ready) — adapted for Kip’s SMS + Meta/X organic social product.

---

## 1. Pricing & packaging (Pro / Max)

Landing shows Pro and Max with monthly / annual (−20%) billing.

### Product work required
- [ ] **Stripe (or equivalent) billing** with Pro and Max products, monthly + annual prices, and tax handling (AU GST if selling in Australia).
- [ ] **Plan entitlements enforced in backend** (not only UI): destination count, brands, memory seats, operator seats, SMS volume, calendar horizon, etc.
- [ ] **Upgrade / downgrade / cancel** flows in-app; prorations documented.
- [ ] **Annual discount** actually applied at checkout (landing −20% must match Stripe coupons/prices).
- [ ] **Failed payment** handling: soft lock, dunning emails, reconnect CTA.
- [ ] **Operator / team seats** on Max: invite, roles, seat limits.
- [ ] **Multi-brand** on Max: brand switcher + data isolation between brands.
- [ ] **Usage meters** (SMS, drafts, publishes) visible on Plan screen and enforced at soft/hard limits.
- [ ] Legal: Terms of Service + refund/cancellation policy aligned with displayed prices.

### Before you advertise
- Prices on the landing page must match live checkout.
- Feature bullets must match what the plan actually unlocks today (no “unlimited” unless truly uncapped).

---

## 2. “Private” / “Your content isn’t used to train models”

### Product + vendor work required
- [ ] **Written DPAs / contracts** with every LLM and vision provider stating customer content is **not used for training** (OpenAI, Anthropic, Google, etc. as applicable).
- [ ] **Default: no training on your data** documented in Privacy Policy + customer-facing Security page.
- [ ] **Prompt / response logging** policy: retention windows, access controls, redaction of phone numbers and media URLs where possible.
- [ ] **Media handling**: temporary blob storage for inbound MMS; TTL deletion after publish or reject; no permanent public URLs.
- [ ] Option (Max?): **customer-managed keys** or dedicated encryption context if you ever claim “your keys.”

### Before you advertise
- Legal review of the exact sentence on the landing page.
- Subprocessor list published and kept current.

---

## 3. “In your control” (approve before publish, disconnect, delete)

Much of this already exists in Pulse; tighten and productize:

### Product work required
- [ ] **Hard gate**: no Meta/X/Threads publish path that bypasses brand (or operator) approval — including retries, schedules, and “auto” modes.
- [ ] **Per-destination revoke**: disconnect Instagram / Facebook / X / Threads removes tokens server-side immediately; UI reflects revoked state.
- [ ] **SMS stop / pause**: STOP keywords + in-app pause; no outbound SMS after pause except required legal notices.
- [ ] **Account deletion**: self-serve or ticketed path that deletes or anonymizes: user, brands, messages, media blobs, OAuth tokens, calendar events, memory files, audit logs (or retain only what’s legally required with stated retention).
- [ ] **Export**: download memory files + message history before delete (GDPR-style portability if you claim EU readiness).
- [ ] **Operator access**: clear disclosure when a human operator can read thread/media; customer can revoke operator access.

### Before you advertise
- Deletion SLA published (e.g. “within 30 days”).
- Privacy Policy + Deletion Policy pages match product behavior.

---

## 4. Encryption, isolation, “built to be audited”

### Product / infra work required
- [ ] **TLS everywhere** (already expected on Netlify/Vercel); HSTS documented.
- [ ] **Encryption at rest** for Postgres (Neon/provider default) + object storage (Blobs/S3) with KMS — confirm and document.
- [ ] **Secrets**: OAuth tokens, Twilio auth, LLM keys in secret manager / env only; never in logs or client bundles.
- [ ] **Tenant isolation**: all queries scoped by `userId` / `brandId`; automated tests for cross-tenant access.
- [ ] **Admin / operator audit trail**: who viewed which brand thread, who approved what, when tokens were rotated.
- [ ] **Customer-visible activity log** (optional Max): logins, publishes, disconnects, plan changes.
- [ ] **Penetration test** (annual) + remediations tracked.
- [ ] **Vulnerability management**: dependency scanning, secret scanning, patch cadence.

### Before you advertise
- Public Security / Trust page with accurate controls (not aspirational).
- Avoid “bank-grade” / “military-grade” wording.

---

## 5. Compliance programs (SOC 2, GDPR, HIPAA — Lindy-style badges)

**Do not put SOC 2 / GDPR / HIPAA badges on the landing page until true.**

### SOC 2 Type I / II
- [ ] Engage auditor; define control set (access, change management, incident response, vendors).
- [ ] Policies: information security, acceptable use, incident response, vendor review.
- [ ] Evidence collection (access reviews, backup tests, deploy controls).
- [ ] Complete Type I (point-in-time) then Type II (period); only then claim “SOC 2.”
- [ ] Prefer “SOC 2 Type II in progress” only if accurate and legal-approved.

### GDPR / UK GDPR / AU Privacy Act
- [ ] Lawful basis + purpose limitation documented.
- [ ] DPA template for customers.
- [ ] Data Processing Agreement with subprocessors.
- [ ] Data residency story if you claim AU/EU hosting (Neon region selection, etc.).
- [ ] DSR (data subject request) runbook + tooling.
- [ ] Cookie / tracking disclosure if analytics added to marketing site.

### HIPAA (only if you ever sell to covered entities)
- [ ] BAA with customers and subprocessors.
- [ ] PHI boundaries — Kip today is social media ops; **do not claim HIPAA** unless product scope and BAAs exist.

### Before you advertise
- Counsel sign-off on every badge and sentence.

---

## 6. Channels & brand claims on the landing page

Claims like “Instagram · Facebook · X · Threads” and “nothing posts without your yes”:

### Product work required
- [ ] Live OAuth + publish for **each** named network (Threads often lags — only list what’s shipping).
- [ ] Unified approval UX across all destinations.
- [ ] Rate-limit / API error surfacing in SMS (“Meta rejected this — want me to rewrite?”).
- [ ] Content policy filters for platforms that reject certain media/captions.

### Before you advertise
- Landing destination list ⊆ production-supported list.

---

## 7. Suggested public pages to add (when ready)

| Page | Purpose |
|------|---------|
| `/security` or Trust Center | Controls, encryption, subprocessors, status |
| `/privacy` | What you collect, retention, training stance |
| `/terms` | Plans, billing, acceptable use |
| `/deletion` | How to request wipe + SLA |
| `/subprocessors` | Living list |
| Status page | SMS / Meta / X incidents |

Landing footer already links Privacy / Terms / Deletion — those routes need real content in the product site.

---

## 8. Recommended claim language (safe → stronger)

| Until checklist green | After checklist green |
|-----------------------|------------------------|
| “Designed so nothing posts without your yes” | Keep — if hard-gated in code |
| “Built toward audited controls” | “SOC 2 Type II certified” + report under NDA |
| “Providers contracted not to train on your content” | Same, with DPA links |
| “Encrypted in transit and at rest” | Same, once infra docs confirm |
| “Disconnect anytime” | Same, once revoke is proven E2E |
| Pro / Max prices | Exact Stripe amounts + GST note |

---

## 9. Owner checklist (ship order)

1. Billing + plan gates (so Pro/Max is real).  
2. Publish hard-gate + disconnect + deletion (so “in your control” is real).  
3. Vendor DPAs + privacy/security pages (so “private” is real).  
4. Audit logs + tenant isolation tests (so “audited” is credible).  
5. SOC 2 / GDPR programs (so badges are legal).  

Until then, the prototype landing can keep the softer trust copy; swap in compliance badges only after legal + eng sign-off.
