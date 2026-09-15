# Kip design language — proposal

<p align="center">
  <img src="../apps/web/public/brand/kip-logo.png" alt="Kip" width="160" />
</p>

**Working name:** *Charcoal Field* · **v4**

Open the specimen: [`prototype/design-language/index.html`](../prototype/design-language/index.html).

---

## 0. What v4 learned (Polsia × Lindy)

We studied **[Polsia](https://polsia.com/)** and **[Lindy](https://www.lindy.ai/)** — landings, social (incl. video), and posters — then rebuilt Kip’s marketing system around what actually works, without wearing either costume.

### Steal / don’t steal

| Source | Steal (physics) | Don’t steal (costume) |
|---|---|---|
| **Polsia** | One claim owns the frame · hard B/W contrast · wheatpaste / wall density · type as architecture · live “proof” whisper · outcome over UI · controversy-as-attention is *their* game, not ours | Times New Roman · terminal chrome · safety orange · “Church of…” cult doctrine · “never hire” aggression · glitch / CCTV cinema |
| **Lindy** | One clear promise in the hero · relief / output framing · social as *done for you* proof · demos *after* the feeling | Cream + royal-blue PLG chrome · integration-orbit heroes · product UI as the first visual · generic SaaS friendliness |

### Kip’s synthesis

> **Polsia’s stop-scroll physics + Lindy’s outcome clarity + Kip’s paper/charcoal studio.**

We sell: **cheap social, completely handled — off their mind.**  
Art = mental quiet. Type = the relief. Disc = the studio seal.

---

## 1. Emotion & outcome (still the north star)

### What we sell

Not “an AI that texts you.” Not “SMS social posting.” Not a clever cat logo.

| Layer | Meaning |
|---|---|
| **Outcome** | Feeds stay alive. Content goes out. No content calendar on their head. |
| **Emotion** | Relief. Exhale. “It’s sorted.” |
| **Price feeling** | Accessible / no-brainer — not luxury agency theatre |
| **Effort feeling** | Near-zero. Thinking was the old cost. |

**Use:** `handled` · `done` · `off your mind` · `sorted` · `free` · `quiet` · `without thinking`  
**Avoid:** `platform` · `suite` · `AI-powered` · `automate your workflow` · feature laundry lists

| Product truth (don’t lead) | Outcome line (lead) |
|---|---|
| Text Kip a photo | Social’s handled. |
| AI drafts captions | You don’t think about it. |
| Approve in the thread | Posted. You’re free. |
| SMS social manager | Off your mind. |

### Job of every marketing piece

1. Name the relief (or show it)
2. Imply the outcome is complete
3. Keep Kip present but quiet (disc seal)
4. Never make them study *how* before they feel *why*

---

## 2. Evolution

| v1 | v2 | v3 | **v4** |
|---|---|---|---|
| Neon volt accent | Abstract art plates | Outcome copy on plates | **Polsia/Lindy physics baked in** |
| Cool product energy | Print-studio costume | Feeling: off their mind | **Type as architecture · Series 04 relief plates · billboard wall · proof whisper** |

---

## 3. Kip anchors (unchanged)

From [`docs/DESIGN.md`](DESIGN.md):

- Mark: hand-drawn charcoal cat on circular disc `#f4f1ea`
- Do not invert, recolour, add a bubble, or tech-ify the cat
- Wordmark: **Kip**, weight 600, tight tracking
- Product chrome stays near-black / paper
- Voice: switched-on mate — warm, sharp, owns being AI

The cat’s dry-brush stroke seeds the art system. Marketing extends that material; it does not invent a second brand.

---

## 4. Concept: Charcoal Field

**One sentence:** Every surface is quiet abstract art; the cat is the studio stamp; the line is the relief when social is no longer their problem.

Three registers:

1. **Mark** — the disc. Sacred, small, corner or seal.
2. **Field** — charcoal / ink / monotype plates. Visual calm = mental calm.
3. **Line** — short display type that names the outcome. On posters, **type is architecture** (Polsia physics): the claim can be as large as the art.

Product UI stays quiet paper. Marketing leans Field + Line.

---

## 5. Colour (pigment, not neon)

### Core

| Token | Hex | Role |
|---|---|---|
| `void` | `#0a0a0a` | Dark fields, dark plates |
| `ink` | `#1d1d1f` | Type on light plates |
| `cat` | `#202020` | Logo strokes only |
| `disc` | `#f4f1ea` | Logo circle — do not recolour |
| `paper` | `#f7f4ee` | Light plate ground |
| `mute` | `#6e6e73` | Secondary type |
| `line` | `#e6e2da` | Soft rules |

### Pigment (inside art only)

| Token | Hex | Role |
|---|---|---|
| `graphite` | `#2c2c2e` | Heavy charcoal mass |
| `wash` | `#5c6570` | Dusty blue-grey stain |
| `smoulder` | `#6b5344` | Warm oxidized brown — sparingly in plates |

No lime. No purple glow. No Polsia orange. No Lindy electric blue as brand chrome.  
CTAs: **disc-on-void** or **ink-on-paper**.

### Proof whisper (optional chrome)

A thin live strip — Polsia’s ticker *physics*, Kip voice — e.g. `social, handled · cheap · done`. Mute text on void or ink on paper. Never orange. Never cult scripture.

---

## 6. Art plates

A **plate** is a reusable abstract artwork — full-bleed ground for posters and posts.

### Series 01 — Core moods

| File | Mood | Format |
|---|---|---|
| `plate-charcoal-sweep.png` | Diagonal dry-brush | 3:4 |
| `plate-ink-bloom.png` | Soft sumi bloom | 3:4 |
| `plate-graphite-field.png` | Dark field + cream cut | 1:1 |
| `plate-gesture-marks.png` | Sparse strokes | 3:4 |
| `plate-monotype.png` | Torn cream / charcoal | 1:1 |


### Series 02 — Expanded

| File | Mood | Format |
|---|---|---|
| `plate-ash-mist.png` | Foggy drift | 9:16 |
| `plate-night-mass.png` | Dense charcoal | 9:16 |
| `plate-single-stroke.png` | One decisive arc | 3:4 |
| `plate-cross-lattice.png` | Brush grid | 3:4 |
| `plate-graphite-dust.png` | Speckled powder | 1:1 |
| `plate-torn-veil.png` | Cream tear | 1:1 |
| `plate-horizon-wash.png` | Horizontal bands | 16:9 |
| `plate-edge-bloom.png` | Left-edge bloom | 16:9 |

### Series 03 — Margin plates (legibility)

Marks in upper/edge zones; lower area empty for type.

| File | Mood | Format |
|---|---|---|
| `plate-margin-arc.png` | Soft arc, upper third | 3:4 |
| `plate-margin-corners.png` | Corner ticks | 3:4 |
| `plate-margin-night.png` | Dark void, faint top wash | 3:4 |
| `plate-margin-dust.png` | Speckle at top | 1:1 |
| `plate-margin-mist.png` | Mist upper half | 9:16 |
| `plate-margin-wide.png` | Wash on left third | 16:9 |

### Series 04 — Relief doctrine (**primary for new work**)

Built after the Polsia/Lindy study. Bigger empty type zones (≥40%). Marks behave like **wheatpaste fields** and **exhales**, not decoration.

| File | Mood | Format | Use |
|---|---|---|---|
| `plate-relief-exhale.png` | Heavy mass lifting off the top | 3:4 | Hero posters — burden leaving |
| `plate-relief-field.png` | Solid charcoal manifesto panel | 3:4 | Type-as-architecture posters |
| `plate-relief-quiet.png` | Sparse corner ticks + air | 3:4 | Soft claims, brand films |
| `plate-relief-nightband.png` | Night void over cream band | 3:4 | “Runs while you sleep” |
| `plate-relief-stripe.png` | Vertical charcoal stripe | 1:1 | Feed tiles — wall density |
| `plate-relief-banner.png` | Left bloom → empty right | 16:9 | Landing / OG heroes |
| `plate-relief-clearing.png` | Storm hatch clearing to silence | 9:16 | Stories — noise → quiet |

### Composition law (non-negotiable)

1. **Split the frame** — art zone + solid type band (**≥40%** height on Series 04; ≥35% elsewhere). Prefer art-heavy split (~60/40) so plates breathe.
2. **Object-position top** — crop from the top; empty lower margins are authored in.
3. **No stroke through glyphs** — if a mark would cross a letter, move type or kill the mark.
4. **Billboard series** — same template every time; only plate + line change.
5. **Type as architecture** — on manifesto posters, the claim can dominate; art is atmosphere, not a wallpaper behind illegible type.
6. **Seal lives with type** — disc sits in the type band (or as a small studio stamp), not overlaid on the art so it becomes the image.
7. **Scrim is last resort** — prefer a solid band; landing heroes may use a dark gradient so type never fights the plate.

### Plate rules

1. Full-bleed — art is the surface, not a card inset.
2. No figurative cats in the plate — the disc carries character.
3. Texture over gloss — paper tooth, charcoal dust, ink bloom.
4. Series coherence — same paper temperature, same charcoal family.
5. Never neon — pigment on paper only.

Brief for new plates: *“Abstract charcoal and ink on warm off-white paper, dry-brush and bloom, gallery print, no text, no logo, no animals, no neon, empty lower type zone ≥40%, [ratio].”*

---

## 7. Typography

| Role | Direction | Notes |
|---|---|---|
| **Display** | `Syne` 700–800 | Odd grotesque — memorable; not Times (Polsia), not Inter (Lindy) |
| **Poster line** | Same, 2–5 words | On light: ink. On dark: paper/disc. Scale like a wheatpaste claim. |
| **Supporting** | `DM Sans` / SF Pro | Calm under the art |
| **Wordmark** | System / SF Pro 600 | Unchanged |

### Copy shape — outcome first

| Use | Avoid |
|---|---|
| `SOCIAL’S HANDLED.` | `SEND THE PHOTO.` |
| `OFF YOUR MIND.` | `TEXT KIP.` |
| `POSTED. YOU’RE FREE.` | `APPROVE IN THE THREAD.` |
| `YOU DON’T THINK ABOUT IT.` | `AI CAPTIONS.` |
| `IT GOES OUT. YOU DON’T.` | `AUTOMATE YOUR WORKFLOW.` |

Whisper lines deepen feeling (“cheap social, completely done”), not the stack.

---

## 8. Poster & post grammar

### Frame budget

1. Full-bleed plate  
2. Disc (brand seal)  
3. One line (+ optional whisper)  
4. Optional tiny meta — never a stats strip or feature pills  

### Modes

| Mode | Plate | Type | Mark |
|---|---|---|---|
| **Paper shout** | Relief / margin light | Oversized ink caps | Disc top-left |
| **Night field** | Nightband / graphite | Oversized paper caps | Disc top-left |
| **Manifesto field** | `relief-field` | Claim fills the cream band | Disc as seal |
| **Feed stripe** | `relief-stripe` | 1–2 words | Disc corner |
| **Landing banner** | `relief-banner` | One promise + CTA | Disc + wordmark |

### Landing (from research)

- **First viewport:** brand (Kip) · one headline · one short sentence · one CTA · one dominant plate. Full-bleed. No stats, no schedules, no card grid.
- Product UI and “how it works” live **below** the feeling (Lindy clarity without Lindy chrome).
- Optional proof whisper under the nav (Polsia ticker physics).

### Social / video

- Prefer **still plates + type** as the house look (print-led brand).
- Video: short verticals that show *life after* — not feature tours first. Founder demos are allowed later (Lindy lane), not as the hero costume.
- Wall density: feed grids should feel like a **poster wall**, not a SaaS carousel.

### Don’t

- Don’t put neon bars, glow, or gradient meshes over plates  
- Don’t recolour or invert the cat  
- Don’t trap art in rounded marketing cards  
- Don’t stack feature pills on the poster  
- Don’t redraw the cat into the abstract field  
- Don’t cosplay Polsia orange/Times/terminal or Lindy blue/integration orbits  

---

## 9. Motion

1. **Settle** — plate fades in (print laid down).  
2. **Arrive** — type rises 8–12px after the plate.  
3. **Seal** — disc last, small scale-in.  

No bounce, no particle ink, no colour-cycle. Respect `prefers-reduced-motion`.

---

## 10. Product vs marketing

| Surface | Language |
|---|---|
| App, auth, legal, operator | Current quiet system (`DESIGN.md`) |
| Landing hero, OG, ads, posters, social | Charcoal Field plates + Syne lines |
| SMS / thread | Voice rules — design must not fight them |

---

## 11. Rollout

1. Series 01–03 locked; **Series 04 is the default for new posters/posts**.
2. Landing hero: `plate-relief-banner` or `plate-relief-exhale` + outcome line + disc.
3. Social kit: stripe + clearing + quiet — wall density, not one lonely card.
4. Promote into [`DESIGN.md`](DESIGN.md) once approved.

---

## 12. Decision checklist

1. Does the line sell **life after Kip** — or how Kip works?  
2. Would a busy owner feel **relief** in under a second?  
3. Is the **art** doing the stopping — or did we fall back to SaaS chrome?  
4. Could this hang on a wheatpaste wall next to Polsia and still look like *Kip*, not a clone?  
5. Is the type band clear (≥40% on Series 04)?  
6. Is the disc present and unaltered?  
7. Did we avoid Polsia orange/cult and Lindy blue/UI-hero?

---

## Specimen

→ [`prototype/design-language/index.html`](../prototype/design-language/index.html)
