# Kip — unit economics & Pro / Max packaging

Working model for list price and feature split. Prices on the landing page are **AUD**.
Provider COGS below are **USD** (Twilio / fal / Anthropic / ElevenLabs bill in USD).

---

## 1. Unit costs

### Messaging (Twilio AU — primary hard case)

| Item | Cost |
|------|------|
| SMS out / in | $0.0515 / $0.0075 |
| MMS out / in (photos) | $0.35 / $0.35 |
| AU mobile number | $8.25/mo (shared across brands) |

US Twilio is ~10× cheaper on MMS (~$0.03 with carrier fees). Linq/iMessage would largely remove Twilio MMS for those users.

### Stills & LLM

| Item | Cost |
|------|------|
| Flux Kontext Pro edit | ~$0.04 / image |
| Flux Schnell / Nano Banana still | ~$0.003–$0.04 |
| Claude Haiku (primary) | $1 / $5 per 1M tok |
| Claude Sonnet (fallback) | $2 / $10 per 1M tok |

### UGC clip (3 scenes × ~5s, product-first)

Ballpark **~$1.00–$1.50 per finished clip** (`UGC_EST_COST_CENTS=150`).

| Piece | Default path | Cost |
|------|----------------|------|
| Stills (3×) | Nano Banana ~$0.04 | ~$0.12 |
| Motion (3×5s) | Kling 2.1 Standard | ~$0.75–$0.84 |
| VO | ElevenLabs ~200–400 chars | ~$0.02–$0.05 |
| Script + score | Claude | ~$0.01–$0.03 |
| **Happy path** | | **~$0.90–$1.10** |
| With 1–2 regens | | **~$1.20–$1.60** |
| Seedance Pro primary | ~$0.62–$0.74 / 5s | **~$2.00–$2.50** / clip |
| Worst case (max regens) | | **~$2.50–$3.00** |

Motion is ~80% of the UGC bill. Keep **Kling primary**; Seedance = fallback / Max premium path.

### Caps already in code

| Cap | Default | Env |
|-----|---------|-----|
| Soft UGC estimate | **$1.50 / job** | `UGC_EST_COST_CENTS=150` |
| Weekly AI spend | **$10 / brand / week** | `AI_WEEKLY_SPEND_CAP_USD` (~6–7 UGC clips) |
| Monthly AI video | **$20 / brand / month** | `AI_VIDEO_COST_CAP_CENTS_MONTH=2000` (~13 clips) |

---

## 2. Combined COGS per active user / month

Assumes AU Twilio + Kling UGC + normal still drafting. Infra (Neon / Vercel / Railway) amortized ~$1–3.

| Persona | Posts / MMS load | UGC clips | Twilio | Stills+LLM | UGC | Infra | **Total COGS** |
|---------|------------------|-----------|--------|------------|-----|-------|----------------|
| **Pro light** | ~16 posts, light chat | 2–4 | ~$19–22 | ~$1.50–2 | ~$3–6 | ~$1–2 | **~$25–32** |
| **Pro heavy** | same + more chat | at Pro soft cap (~4) | ~$22–26 | ~$2 | ~$6 | ~$2 | **~$32–36** |
| **Max normal** | ~32 posts, full engagement | 6–8 | ~$35–40 | ~$3–4 | ~$9–12 | ~$2–3 | **~$49–59** |
| **Max at video cap** | heavy | ~13 | ~$40 | ~$4 | ~$15–20 | ~$3 | **~$62–67** |

UGC at normal use is roughly **10–25% of Pro list price** and **~8–15% of Max** — fine if caps hold. Without caps, Seedance-default or regen-heavy users blow the model.

---

## 3. List prices (already on landing)

| Plan | Monthly (AUD) | Annual equiv. | Target gross margin |
|------|---------------|---------------|---------------------|
| **Pro** | **$79** | $63/mo ($756/yr, −20%) | ~60–68% on Pro-light/heavy AU |
| **Max** | **$149** | $119/mo ($1,428/yr) | ~55–67% even near UGC cap |

USD COGS vs AUD revenue: treat FX as a small buffer (~1–2 pts), not a separate line.

If Seedance becomes default, bump `UGC_EST_COST_CENTS` toward **200–250** and/or raise Max price / tighten caps — otherwise you under-charge.

---

## 4. Feature split — Pro vs Max

Principle: **same product, Max buys autonomy + higher AI ceilings + growth levers.**
Do not hide the core “text a photo → publish” loop behind Max.

### Included on both

| Feature | Notes |
|---------|--------|
| SMS / iMessage thread | One thread for drafts, approvals, escalations |
| Photo → caption → approve → publish | Table stakes |
| Photo styling (Flux) | Soft monthly restyle budget (see caps) |
| IG + Facebook | Core surfaces |
| X / Threads when live | Same on both once configured |
| Content plan + calendar | Pillars / cadence |
| Weekly check-in + Friday recap | Low COGS, high trust |
| Brand voice learning | Corrections fold in |
| Client-sent Reel drafting | Caption/edit their clip (cheap vs gen) |
| Safe comment auto-replies | Toggle; not a Max upsell |

### Pro-only shape (default on)

| Feature | Pro |
|---------|-----|
| Approvals | Owner taps yes in-thread (autopilot **off** by default) |
| Gap-fill | On, but capped (1 touch/brand/day already) |
| UGC / AI video | **Light** — soft cap ~4 clips/mo (~$6) |
| Competitor watches | Off or **1** ad-hoc |
| Campaigns / URL repurpose | Allowed, soft monthly count |
| Ads / boost | **Off** |
| Routines / editable memory UI | Read-mostly; Kip runs defaults |
| Setup | Self-serve |

### Max adds (the upsell)

| Feature | Max |
|---------|-----|
| **Autopilot** with heads-up / HOLD | Pillars auto-schedule; owner can kill |
| **Full engagement** | Draft judgment calls + lead handoff + sentiment spikes |
| **UGC allowance** | Up to monthly video cap (~$20 / ~12–13 clips) |
| **Seedance / premium motion** | Allowed when Kling fails or owner asks “higher quality” |
| Competitor watches | Full **3** + weekly digests |
| Campaigns + repurpose | Unlimited within scheduler guards |
| **Ads** toggle | Spend on **owner’s** ad account; Kip proposes/boosts |
| Ads autopilot | Optional second toggle |
| Editable memory + sentence routines | Dashboard `/app/routines`, design memory |
| Priority setup | Human/Pulse onboarding assist |
| CRM webhook | When Phase I ships |

### Usage ceilings (monetization — to implement as entitlements)

Today most caps are global ops guards, not plan-aware. Target:

| Ceiling | Pro | Max |
|---------|-----|-----|
| UGC / AI video / mo | **~$6** (~4 clips @ $1.50) | **~$20** (~13 clips) |
| Weekly AI spend | **$5** | **$10** (current global default) |
| Image restyles / mo | **40** | **100** |
| Competitor watches | **0–1** | **3** |
| Outbound MMS soft cap | **50** | **120** |
| Autopilot | Off default | On (per-pillar) |
| Ads | Locked off | Unlockable |

Overage: soft refuse in SMS (“hit this month’s AI video budget”) + upsell to Max / wait until next period — already the UGC pattern.

---

## 5. What not to tier

- Basic drafting quality (same Haiku path)
- Platform count for IG/FB
- “Being on brand” / voice learning
- Check-ins and recaps
- Holding MMS drafts behind Max (that *is* the product)

Max should feel like **“hand Kip the lot”**, not **“Pro but captions work.”**

---

## 6. Landing copy alignment

Current `PricingPlans` bullets are directionally right. Prefer concrete ceilings over vague “priority”:

**Pro:** everyday posting, approvals in thread, light UGC (a few AI clips/mo), calendar + weekly recap.

**Max:** everything in Pro + autopilot, full inbox/leads, full UGC budget, competitor watch, ads when you want them, routines/memory, priority setup.

---

## 7. Open implementation work

1. Gate `brands.features` + UGC/video caps on `facts.plan.tier` (`pro` | `max`).
2. Per-tier `AI_VIDEO_COST_CAP` / weekly spend (Pro $6–8 video mo; Max keep $20).
3. Default `autopilot` / `ads` false on Pro signup; true-capable on Max.
4. Keep Kling primary; only expose Seedance path on Max or as explicit “premium regen.”
5. Revisit AUD list price if AU Twilio stays primary *and* average UGC > 8 clips on Pro.
