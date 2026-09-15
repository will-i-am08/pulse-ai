# Kip design language — proposal

<p align="center">
  <img src="../apps/web/public/brand/kip-logo.png" alt="Kip" width="160" />
</p>

**Working name:** *Charcoal Field*

Research note: the reference called “Pulsier” maps to **[Polsia](https://polsia.com/)** (AI business builder). We keep Polsia’s *physics* — one claim owns the frame, hard contrast, stop-scroll presence — and build a Kip-native system around the cat mark. **v2 pivot:** less neon signal colour, more **abstract art plates** for posters, social posts, and campaign surfaces.

Open the interactive specimen: [`prototype/design-language/index.html`](../prototype/design-language/index.html).

---

## 1. What changed from v1

| v1 (Charcoal Signal) | v2 (Charcoal Field) |
|---|---|
| Neon **volt** lime as the live accent | No neon. Atmosphere comes from **art plates** |
| Type + black void + underline tick | Type sitting on / in abstract ink fields |
| Signal colour = brand memory | Brush language of the cat = brand memory |

Polsia still informs scale and sparseness. The costume is now closer to a **print studio / gallery poster** than a terminal dashboard.

---

## 2. What Polsia does well (still steal the physics)

| Polsia move | Kip translation |
|---|---|
| One claim owns the frame | 2–4 word mate-voice lines |
| Hard to miss in a feed | Full-bleed abstract plate + sparse type |
| Premium through restraint | Paper, charcoal, quiet pigment — not SaaS gradients |
| Posters that feel like statements | Art first, copy second, disc as the quiet brand seal |

**Do not copy:** Times body, orange live state, terminal chrome, green logs, anti-hire threat copy.

---

## 3. Kip anchors (keep)

From [`docs/DESIGN.md`](DESIGN.md):

- Mark: hand-drawn charcoal cat on circular disc `#f4f1ea`
- Do not invert, recolour, add a bubble, or tech-ify the cat
- Wordmark: **Kip**, weight 600, tight tracking
- Product chrome stays near-black / paper
- Voice: switched-on mate — warm, sharp, owns being AI

The cat’s **dry-brush stroke** is the seed of the whole art system. Marketing extends that material into large abstract fields; it does not invent a second brand.

---

## 4. Concept: Charcoal Field

**One sentence:** Every poster is an abstract print; the cat is the studio stamp; the line is the text you’d send.

Three registers:

1. **Mark** — the disc. Sacred, unchanged, small in the corner or as a seal.
2. **Field** — abstract charcoal / ink / monotype plates. The eye-catcher.
3. **Line** — short display type laid into the field with huge breathing room.

Product UI stays quiet paper. Marketing, posters, OG images, ads, and social tiles lean Field + Line.

---

## 5. Colour (pigment, not neon)

### Core

| Token | Hex | Role |
|---|---|---|
| `void` | `#0a0a0a` | Dark fields, dark plates |
| `ink` | `#1d1d1f` | Type on light plates |
| `cat` | `#202020` | Logo strokes only |
| `disc` | `#f4f1ea` | Logo circle — do not recolour |
| `paper` | `#f7f4ee` | Light plate ground / soft chrome |
| `mute` | `#6e6e73` | Secondary type |
| `line` | `#e6e2da` | Soft rules |

### Pigment (quiet accents inside art only)

| Token | Hex | Role |
|---|---|---|
| `graphite` | `#2c2c2e` | Heavy charcoal mass |
| `wash` | `#5c6570` | Dusty blue-grey ink stain |
| `smoulder` | `#6b5344` | Warm oxidized brown in monotype edges — use sparingly inside plates, never as a UI theme |

No lime. No purple glow. No brand orange. Accents live **inside** the artwork as pigment, not as UI chrome or CTA fills.

CTAs on marketing can stay **disc-on-void** or **ink-on-paper** — solid, quiet, premium.

---

## 6. Art plates (the system)

A **plate** is a reusable abstract artwork that becomes the full-bleed ground for a poster or post. Plates are the brand’s visual volume.

### Series 01 (in specimen)

| File | Mood | Best for |
|---|---|---|
| `plate-charcoal-sweep.png` | Diagonal dry-brush on paper | Quote posters, launch |
| `plate-ink-bloom.png` | Soft sumi bloom | Calm / brand films / stories |
| `plate-graphite-field.png` | Dark field + cream cut | High-contrast feed ads |
| `plate-gesture-marks.png` | Sparse strokes on paper | Closest to the cat’s hand |
| `plate-monotype.png` | Torn cream / charcoal + wash | Editorial, carousels |

### Plate rules

1. **Full-bleed** — the art is the surface, not a card inset.
2. **No figurative cats** in the plate — the disc carries the character.
3. **Texture over gloss** — paper tooth, charcoal dust, ink bloom. Avoid plastic gradients.
4. **Series coherence** — same paper temperature, same charcoal family, so five plates still feel like one studio.
5. **Leave a quiet zone** — every plate needs a soft area for type (corner or band).
6. **Never neon** — if a colour appears, it should look like pigment on paper.

### How to commission / generate more

Brief: *“Abstract charcoal and ink on warm off-white paper, dry-brush and bloom, gallery print, no text, no logo, no animals, no neon, vertical poster.”* Keep the Kip logo nearby as a **material reference** (stroke weight / irregularity), not as content to redraw.

---

## 7. Typography

| Role | Direction | Notes |
|---|---|---|
| **Display** | `Syne` 700–800 | Slightly odd grotesque — memorable without shouting neon |
| **Poster line** | Same, 2–4 words | On light plates: ink. On dark plates: paper/disc |
| **Supporting** | `DM Sans` / SF Pro | Calm under the art |
| **Wordmark** | System / SF Pro 600 | Unchanged |

### Type on art

- Prefer **large, few words** over paragraphs.
- Sit type in the plate’s quiet zone; don’t fight the densest brush mass.
- Avoid coloured underlines. Emphasis = scale and placement, or a single word in the disc colour on dark fields.

### Copy shape

Mate voice, poster volume:

- `SEND THE PHOTO.`
- `KIP’S ON IT.`
- `TEXT IT. POSTED.`
- `APPROVE IN THE THREAD.`

---

## 8. Poster & post grammar

### Frame budget

1. Full-bleed plate
2. Disc (brand seal)
3. One line (optional second whisper line)
4. Optional tiny meta (url / @kip) — never a stats strip

### Compositions

| Mode | Plate | Type | Mark |
|---|---|---|---|
| **Paper shout** | Light plate (sweep / gesture) | Oversized ink caps | Disc top-left |
| **Night field** | Dark plate (graphite) | Oversized paper caps | Disc top-left |
| **Bloom calm** | Ink bloom | Smaller centered line | Disc bottom |
| **Monotype split** | Torn cream/charcoal | Type in the cream half | Disc on the seam |
| **Feed tile** | Any plate, 1:1 crop | 2–3 words | Disc corner |

### Don’t

- Don’t put neon bars, glow, or gradient meshes over plates
- Don’t recolour or invert the cat
- Don’t trap the art in a rounded marketing card
- Don’t stack feature pills on the poster
- Don’t redraw the cat into the abstract field

---

## 9. Motion

1. **Settle** — plate fades/eases in slightly (like a print laid down).
2. **Arrive** — type rises 8–12px after the plate.
3. **Seal** — disc appears last, small scale-in.

No bounce, no particle ink, no colour-cycle. Respect `prefers-reduced-motion`.

---

## 10. Product vs marketing

| Surface | Language |
|---|---|
| App, auth, legal, operator | Current quiet system |
| Landing hero, OG, ads, posters, social | Charcoal Field plates + Syne lines |
| SMS / thread | Voice rules — design must not fight them |

---

## 11. Rollout

1. Lock plate series 01 (in `prototype/design-language/plates/`).
2. Export poster templates (story 9:16, feed 1:1, portrait 3:4).
3. Landing hero: swap stock/photo-only hero for one plate + line + disc (keep real shop photo as an alternate mode).
4. Social kit: 5 posts from the five plates, same type recipe.
5. Promote this doc into [`DESIGN.md`](DESIGN.md) once approved.

---

## 12. Decision checklist

1. Is the **art** doing the stopping — or did we fall back to neon/UI chrome?
2. Does the plate still feel like the same studio as the cat’s brush?
3. Can you read the line from across the room?
4. Is the disc present and unaltered?
5. Would this still look like Kip if we dropped it into a gallery wall of abstract prints?

---

## Specimen

→ [`prototype/design-language/index.html`](../prototype/design-language/index.html)
