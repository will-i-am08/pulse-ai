# Kip design language — proposal

<p align="center">
  <img src="../apps/web/public/brand/kip-logo.png" alt="Kip" width="160" />
</p>

**Working name:** *Charcoal Signal*

Research note: the reference called “Pulsier” maps to **[Polsia](https://polsia.com/)** (AI business builder). This proposal takes Polsia’s *energy* — manifesto type, hard stop-scroll contrast, one live accent — and builds a Kip-native system around the cat mark, SMS product, and mate voice. It does **not** copy Polsia’s Times/terminal/orange recipe.

Open the interactive specimen: [`prototype/design-language/index.html`](../prototype/design-language/index.html).

---

## 1. What Polsia does well (steal the physics, not the costume)

| Polsia move | Why it works | Kip translation |
|---|---|---|
| Manifesto headlines (“NEVER HIRE AGAIN”) | One claim owns the frame | Short SMS-native lines: “SEND THE PHOTO.” / “KIP’S ON IT.” |
| Black ↔ white only + one accent | Instant grammar; orange = live | Charcoal ↔ paper/disc + one **volt** accent = “draft ready / Kip awake” |
| Editorial authority at billboard scale | Feels premium, not SaaS-template | Oversized display type on black or full-bleed shop photo |
| Terminal as metaphor | Product *is* autonomous ops | Kip’s metaphor is the **text thread**, not a console — keep iMessage/real photo, never `>` prompts |
| Posters that are mostly type | Hard to miss in a feed | Marketing surfaces = type + disc + photo. No cards, no badge clusters |

**Explicitly do not copy from Polsia:** Times New Roman body, orange `#F97316`, terminal headers, green log text, newspaper underlines, “NEVER HIRE AGAIN” tone. Kip stays warm and human; Polsia stays austere and machine.

---

## 2. Kip’s existing anchors (keep)

From [`docs/DESIGN.md`](DESIGN.md):

- Mark: hand-drawn charcoal cat on circular disc `#f4f1ea`
- Do not invert, recolour, add a bubble, or tech-ify the cat
- Wordmark: **Kip** (not KIP / Kip AI), weight 600, tight tracking
- Product chrome stays near-black / paper; client brands bring their own colour
- Voice: switched-on mate — warm, sharp, owns being AI

The new language **amplifies** the mark for marketing. It does not replace the quiet product UI overnight.

---

## 3. Concept: Charcoal Signal

**One sentence:** The cat is intimate ink; the marketing is a billboard that texts you back.

Three registers:

1. **Ink** — the cat’s brush strokes. Organic, quiet, human.
2. **Billboard** — oversized type on black or photography. Unmissable.
3. **Signal** — a single electric accent that means Kip is working / a draft is waiting.

Product UI stays mostly Ink + paper. Marketing, posters, OG images, ads, and the landing hero lean Billboard + Signal.

---

## 4. Colour

### Core (unchanged)

| Token | Hex | Role |
|---|---|---|
| `void` | `#000000` | Marketing field, landing hero, posters |
| `ink` | `#1d1d1f` | Body on light |
| `cat` | `#202020` | Logo strokes only |
| `disc` | `#f4f1ea` | Logo circle — sacred; do not recolour |
| `paper` | `#ffffff` / `#f6f7f9` | App chrome |
| `mute` | `#6e6e73` | Secondary |
| `line` | `#ececec` | Hairlines in app |

### Signal (new — marketing + live states only)

| Token | Hex | Role |
|---|---|---|
| `volt` | `#D6FF3F` | Live / ready / CTA underline / poster tick |
| `volt-ink` | `#12140A` | Text on volt fills |

**Why volt, not orange/purple/blue:** Polsia already owns warm orange-as-live. Purple is AI-default. Facebook blue is banned from Kip chrome. Lime/volt on black is poster-native, hard to miss, and still feels premium when used as a *signal* (underline, corner tick, “DRAFT READY” chip) rather than a wash.

**Rule:** Volt never recolours the cat or the disc. Max ~5% of any marketing frame.

### Surfaces

- Marketing default: `void` + white type + `disc` mark + optional `volt` tick
- Alternate: full-bleed real shop photography (already `thread-photo.jpg` energy) with black gradient for type
- App: keep paper chrome; volt only for “Kip is drafting / sent / live” indicators

---

## 5. Typography

Product UI can keep SF Pro. Marketing needs a voice you can spot across a room.

| Role | Direction | Notes |
|---|---|---|
| **Display** | `Syne` (700–800) or similar quirky grotesque | Slightly odd proportions = memorable; not Times, not Inter |
| **Poster shout** | Same family, ALL CAPS, 4 words max | Tight leading (~0.9–1.0), slight negative tracking |
| **Supporting** | `DM Sans` or SF Pro | Calm; lets display do the personality |
| **Mono (rare)** | `IBM Plex Mono` | Only for timestamps / message meta — *not* a terminal skin |

### Type recipes

```
Poster H1:  Syne 800 · clamp(64px, 12vw, 140px) · tracking -0.04em · leading 0.92
Landing H1: Syne 700 · clamp(48px, 8vw, 96px)  · tracking -0.035em
Body:       DM Sans / SF Pro 400–500 · 15–17px · leading 1.4
Wordmark:   SF Pro / system 600 · -0.02em (unchanged)
```

### Copy shape for posters (Kip voice, Polsia scale)

- 2–4 words. Period optional.
- Imperative or status, never agency-speak.
- Examples: `SEND THE PHOTO.` · `KIP’S ON IT.` · `TEXT IT. POSTED.` · `APPROVE IN THE THREAD.`

Avoid Polsia-style threat copy (“never hire again”). Kip is a mate who takes the work, not a replacement army.

---

## 6. Layout & poster grammar

### Hero / poster budget (marketing)

First viewport / poster frame contains **only**:

1. Kip disc (brand-first — must survive without the nav)
2. One shout line
3. One short support sentence *or* one CTA
4. One dominant image plane (full-bleed photo **or** pure void)

No stats strips, schedule chips, feature cards, or floating badges on the hero.

### Composition modes

| Mode | Field | Type | Mark | Accent |
|---|---|---|---|---|
| **Void shout** | Black | White Syne caps | Disc bottom-left or top-left | Volt underline under last word |
| **Photo thread** | Full-bleed shop photo + top black wash | White | Disc in corner | Optional volt on CTA |
| **Disc field** | Large disc colour wash | Charcoal type | Giant mark as watermark (low opacity) | Volt corner tick |
| **Split signal** | Black left / photo right | White left | Disc over the seam | Volt hairline on the seam |

### Don’t

- Don’t put the cat on volt or invert it white
- Don’t add chat-bubble chrome *to the logo* (product UI may still show a real thread)
- Don’t use rounded marketing cards as the hero idea
- Don’t stack pill clusters or icon rows

---

## 7. Motion

Ship 2–3 intentional motions (marketing + landing):

1. **Arrive** — headline rises ~8–12px and fades in (like a text landing). 400–600ms, ease-out.
2. **Tick** — volt underline draws left→right under the shout line once.
3. **Breathe** — disc scale 1.0 → 1.02 → 1.0 on a slow loop *only* when Kip is “awake” / drafting; respect `prefers-reduced-motion`.

No bounce. No glow stacks. No particle fields.

---

## 8. Photography

Keep the current rule: real shop photos a client would actually post. Full-bleed. Grain and imperfect light beat AI gloss.

Lockup: photography carries atmosphere; type carries the claim; the disc carries the brand. Never sticker the photo with promo chips.

---

## 9. Product vs marketing split

| Surface | Language |
|---|---|
| `/app`, auth, legal, operator chrome | Current quiet system (paper, SF Pro, hairlines) |
| `/` landing hero, OG, ads, posters, pitch | Charcoal Signal (void, Syne, volt, manifesto lines) |
| In-thread / SMS | Voice rules in `persona.ts` — design must not fight them |

Volt can later enter the app as a single “draft ready” / “Kip typing” indicator without painting the whole console green-yellow.

---

## 10. Competitive contrast

| Brand | Feel | Kip difference |
|---|---|---|
| Polsia | Newspaper + terminal + orange live | Kip = ink cat + SMS mate + volt signal |
| Blaze / typical AI marketing | Soft SaaS gradients, feature grids | Kip = one claim, one photo, one mark |
| Apple-like quiet SaaS (current Kip) | Premium but easy to scroll past | Keep quiet in-app; turn volume up on marketing only |

---

## 11. Rollout suggestion

1. **Adopt tokens** — add `--volt`, display font link, poster type scale (no product UI paint yet).
2. **Poster kit** — 4 templates (void shout / photo thread / disc field / split signal) for ads + OG.
3. **Landing pass** — swap hero display face + one volt CTA treatment; keep photo thread composition.
4. **App hint** — optional volt “draft ready” dot in the operator console.
5. **Update** [`docs/DESIGN.md`](DESIGN.md) once the direction is locked (this file is the proposal).

---

## 12. Decision checklist

When reviewing a new Kip marketing piece, ask:

1. If I cover the nav, is the **disc** still the brand?
2. Can I read the claim from across the room?
3. Is volt under 5% of the frame?
4. Would this still look like Kip if Polsia’s orange/serif were swapped in? (If yes, redesign — too close.)
5. Does the copy sound like a text from a mate, not a manifesto against hiring?

---

## Specimen

Interactive posters, type ramp, and colour chips:

→ [`prototype/design-language/index.html`](../prototype/design-language/index.html)
