# Blaze.ai — competitive reference (content generation)

Deep-dive of blaze.ai's public site, cataloguing every demo/example of *generated content*
they show, as a benchmark for our static AI photo-content feature. Captured 3 Sep 2026.

## What Blaze is

An **all-in-one "marketing done for you" platform** — social, paid ads, landing pages,
reputation, and an AI phone-answering SDR. Self-serve from **$79/mo**; fully managed
("Done For You") from **$999/mo**. 4.6 Trustpilot / 4.8 Capterra. The two products that
matter to us:

1. **Blaze Studio** — an **iOS app that restyles/re-lights everyday phone photos into
   "studio-quality" stills.** This is the *direct* analogue of what we're building.
2. **Done For You** — a managed service that produces a full **multi-channel content
   calendar** (designed social posts, blogs, emails, video) from a brand's inputs.

---

## 1. Blaze Studio — the direct reference (AI photo restyling)

> "Transforms everyday iPhone photos into professionally-lit, studio-quality content."
> "Not a filter — filters apply a flat colour grade; Blaze Studio uses AI to **re-light
> and restyle**, adjusting depth, mood and atmosphere… looks like a pro shot it."

- **Flow:** 1) Upload a photo → 2) Select a visual style → 3) AI generates → 4) Edit & share.
- **Pricing signal:** **5 credits per generation.** Studio plans $7.99/mo (90 credits) /
  $12.99/mo (120 credits + AI video). So ~18 images/mo at the low tier — a useful price anchor.
- **Style categories they demo** (this is a good taxonomy for our own styles):
  Product Photography · Selfies & Portraits · Lifestyle Photos · Travel & Landscape · Food & Drink.

### What their output actually looks like — my observation
Their headline before/after (a skier) is a **dramatic, generative reinterpretation**, not a
faithful edit: the "Original" is an ordinary mid-distance phone snap; the "AI Style" result is
a punchy, close-cropped, dramatically-lit magazine action shot — **different composition,
different pose, different framing.** It looks fantastic, but it's clearly *re-generated*, not
*retouched*. (Local copies saved: `scratchpad/blaze/studio-original.png`, `studio-ai.png`.)

> **The key decision this forces for us:** how far do we go — *faithful enhancement*
> (same photo, better light/colour/background) vs *generative reinterpretation* (a new,
> better-looking image that may not match reality)? Blaze goes full reinterpretation. For a
> business posting *its actual product/premises*, that can be a problem (the post no longer
> shows the real thing); for personal/lifestyle it's often fine. Likely answer: offer both,
> and default by account type.

### Blaze Studio demo assets (CDN)
Base: `https://cdn.prod.website-files.com/64cd367074be316f3359db61/`
- Before/after: `69b04f9f261223ab6ad8e5df_Original.png` · `69b04fa033b3879e429a1b69_AI%20asset.png` · `69b04f9dd38b5194e1551beb_iPhone.avif`
- Style categories: `69a8be6ee007c8fb148e9383_Product%20Photography.avif` · `69a8be6e82c4d30246f57bed_Selfies%20%26%20Portraits.avif` · `69a8be6d3fb7531e5b9c5372_Lifestyle%20Photos.avif` · `69a8be6e7475714e4a6cac1c_Travel%20%26%20Landscape.avif` · `69a8be6ecb9aac50ff71d1fd_Food%20%26%20Drink.avif`
- How-it-works visual: `69b07280d2b174eb57ffd2b1_how%20it%20works2v2%20(1).avif`

---

## 2. Done-For-You — generated social content (designed posts)

Their DFY demo shows a **content calendar** (a coffee-roaster brand) full of AI-generated,
scheduled items across 8 channels (IG/FB/LinkedIn/X/TikTok/YouTube, blog/WordPress, email):

- **Social posts = photo + bold headline text overlaid** ("This is where the flavor is decided.",
  "We taste every batch until only the right one…"), plus a written caption underneath.
- Also: blog posts (hero image + article), email campaigns ("Snag 20% Off…"), short video.
- Statuses (Posted / Review / Scheduled) — i.e. a human-approval step like ours.

> **Worth flagging vs your call earlier:** you ruled out "designed text-on-photo tiles" for
> our build — but Blaze leans on them *heavily* for **business** content, because a headline
> on the image is what makes a plain product photo read as a "post". Might be worth revisiting
> tiles for the business side (cheap to do with Satori/Sharp) even though the AI-restyle is the
> headline feature.

### DFY demo assets (CDN, same base)
- Content preview cards (the calendar UI): `6a19d59b5801f7a74fc1ea76_Card%20Content%20Container.png` … `Container2…5` (`_Card%20Content%20Container2.png`, `3`, `4`, `Container5`)
- Accountant case-study posts: `69ee47915ce66f44d7ebe7d6_acc-01.png` · `69ee4791523b2ecb4369dbd3_acc-02.png` · `69ee4791011a8d4035a6d014_acc-03.avif`
- Accountant content cards: `69fa7e829a254480b6bdf9d0_acc-c-01a.avif` · `69f23a5debbaf3f4dc614eb2_acc-c-03.avif` · `69fa819b3700e2098c538b97_acc-c-03b.png` · `69f23a5d00330bd5e3330293_acc-c-05.avif` · `69fa8199e4ea42863cc87875_acc-c-05b.png` · `69fa88081f8848201777c1e7_acc-c-07.png`
- Mobile mockups: `69fa97ffaa256e99b3c2d807_acc-dfy-mob-01.png` · `69fa97ffc067d6f1e0eb8986_acc-dfy-mob-02.avif` · `69fa97ff7828c3e0f6bf5b5b_acc-dfy-mob-03.png`
- Example post images: `69fa1e7f4a1bab3f0a963897_image%20771.jpg` · `69fa1e7f664d2e98b11b7d9d_image%20772.avif`
- Content frames: `69f280277714f632bd74103a_Frame%202147229376.png` · `69f39786216a634a08f724d8_Frame%202147229378.avif`

*(Not content demos, excluded: ~90 testimonial headshots (`*Quote Photo*`, person-name files),
customer logos (accountants, pictarine, decimal, axis-vehicles, Nomad, machiavel, brandedstein),
and marketing photos like `image 773.jpg` — a lit portrait used as a section background.)*

---

## Takeaways for our build

1. **The quality bar is high and it's *generative*.** Blaze's "wow" comes from re-generating a
   better image, not retouching. We should demo the same on Replicate (Flux Kontext / SDXL) to
   see if we can match it, and decide faithful-vs-generative per account type.
2. **Their style taxonomy is a ready-made menu** for us: Product · Selfies/Portraits · Lifestyle ·
   Travel/Landscape · Food & Drink. Good defaults to offer.
3. **Pricing anchor: ~5 credits (a few cents) per image**, sold in monthly credit packs. Confirms
   the per-image AI cost is small and a credits model is the norm.
4. **They split a focused mobile "Studio" app from the main platform** — a signal that photo
   styling is a distinct, sticky feature worth its own surface.
5. **Even Blaze uses text-on-photo tiles for business** — reconsider adding cheap OSS tiles
   (Satori/Sharp) alongside the AI restyle, at least for the business side.
6. **Human approval is in their flow too** (Review/Posted states) — matches our absolute-approval model.
