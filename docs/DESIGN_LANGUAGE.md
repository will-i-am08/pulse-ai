# Kip design language — proposal

<p align="center">
  <img src="../apps/web/public/brand/kip-logo.png" alt="Kip" width="160" />
</p>

**Working name:** *Charcoal Field*

Research note: the reference called “Pulsier” maps to **[Polsia](https://polsia.com/)** (AI business builder). We keep Polsia’s *physics* — one claim owns the frame, hard contrast, stop-scroll presence — and build a Kip-native system around the cat mark. **v2 pivot:** less neon signal colour, more **abstract art plates** for posters, social posts, and campaign surfaces.

**v3 pivot (this pass):** sell the **outcome and feeling**, not the cool product. Kip is cheap social media management that is simply *done* — without the customer having to think about it. Art and type should make that relief feel true.

Open the interactive specimen: [`prototype/design-language/index.html`](../prototype/design-language/index.html).

---

## 0. Emotion & outcome (start here)

### What we sell

Not “an AI that texts you.” Not “SMS social posting.” Not a clever cat logo.

We sell: **social media completely handled — cheaply — so it’s off their mind.**

| Layer | Meaning |
|---|---|
| **Outcome** | Their feeds stay alive. Content goes out. They don’t run a content calendar. |
| **Emotion** | Relief. Exhale. “It’s sorted.” Lightness where Instagram used to sit on their head. |
| **Price feeling** | Accessible / no-brainer — not luxury agency theatre, not “enterprise AI platform.” |
| **Effort feeling** | Near-zero. They don’t have to think. Thinking was the old cost. |

### Feeling words (use)

`handled` · `done` · `off your mind` · `sorted` · `free` · `quiet` · `without thinking` · `taken care of`

### Feeling words (avoid)

`powerful` · `platform` · `suite` · `automate your workflow` · `AI-powered` · `next-gen` · `revolutionary` · feature laundry lists

### Product → outcome translation

| Product truth (don’t lead with) | Outcome line (lead with) |
|---|---|
| Text Kip a photo | Social’s handled. |
| AI drafts captions | You don’t think about it. |
| Approve in the thread | Posted. You’re free. |
| SMS social manager | Off your mind. |
| Cheap vs an agency | Sorted. Without the bill. |
| Runs while you work | It goes out. You don’t. |

### How the art supports the feeling

Charcoal Field is not decoration for a tech demo. The abstract plates should feel like **mental quiet**:

- Soft mist / bloom / empty paper = the weight lifting
- Night mass / dark field = it runs while they sleep / while they’re on the tools
- Single stroke / sparse gesture = one small act, then done
- Wide empty ground = room to breathe

If a poster looks “cool” but still reads as *product marketing*, rewrite the line until it reads as **life after Kip**.

### Job of every marketing piece

1. Name the relief (or show it)
2. Imply the outcome is complete
3. Keep Kip present but quiet (disc seal)
4. Never make them study how it works before they feel why they want it

---

## 1. What changed from v1

| v1 | v2 | v3 |
|---|---|---|
| Neon **volt** lime accent | Abstract **art plates** | Same plates, **outcome copy** |
| Type + black void + underline | Type on ink fields | Lines sell relief, not features |
| Cool product energy | Print-studio costume | Feeling: social is off their mind |

Polsia still informs scale and sparseness. The costume is a **print studio / gallery poster**. The message is life after social is handled.

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

**One sentence:** Every poster is quiet abstract art; the cat is the studio stamp; the line is the relief they’ll feel when social is no longer their problem.

Three registers:

1. **Mark** — the disc. Sacred, unchanged, small in the corner or as a seal.
2. **Field** — abstract charcoal / ink / monotype plates. Visual calm = mental calm.
3. **Line** — short display type that names the outcome, not the mechanism.

Product UI stays quiet paper. Marketing leans Field + Line — and the line must pass the outcome test: *does this describe life after Kip, or how Kip works?*

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

### Series 01 — Core moods

| File | Mood | Format | Best for |
|---|---|---|---|
| `plate-charcoal-sweep.png` | Diagonal dry-brush on paper | 3:4 | Quote posters, launch |
| `plate-ink-bloom.png` | Soft sumi bloom | 3:4 | Calm / brand films / stories |
| `plate-graphite-field.png` | Dark field + cream cut | 1:1 | High-contrast feed ads |
| `plate-gesture-marks.png` | Sparse strokes on paper | 3:4 | Closest to the cat’s hand |
| `plate-monotype.png` | Torn cream / charcoal + wash | 1:1 | Editorial, carousels |

### Series 02 — Expanded moods & formats

| File | Mood | Format | Best for |
|---|---|---|---|
| `plate-ash-mist.png` | Foggy charcoal drift | 9:16 | Soft story openers |
| `plate-night-mass.png` | Dense charcoal + cream type band | 9:16 | Night stories / reels covers |
| `plate-single-stroke.png` | One decisive arc on paper | 3:4 | Quiet hero posters |
| `plate-cross-lattice.png` | Overlapping brush grid | 3:4 | Textured campaigns |
| `plate-graphite-dust.png` | Speckled powder field | 1:1 | Subtle feed tiles |
| `plate-torn-veil.png` | Cream tear into charcoal | 1:1 | Carousel covers |
| `plate-horizon-wash.png` | Horizontal ink bands | 16:9 | OG images / site banners |
| `plate-edge-bloom.png` | Left-edge bloom → empty paper | 16:9 | Wide landing heroes |

**Studio total: 13 plates.**

### Format map

| Crop | Ratio | Prefer |
|---|---|---|
| Poster / portrait | 3:4 | sweep, bloom, gesture, single-stroke, cross-lattice |
| Story / reel | 9:16 | ash-mist, night-mass (+ bloom cropped) |
| Feed | 1:1 | graphite-field, monotype, graphite-dust, torn-veil |
| OG / banner | 16:9 | horizon-wash, edge-bloom |



### Series 03 — Margin plates (legibility-first)

After review: busy full-bleed charcoal was covering headlines. Series 03 follows **gallery-poster / quiet-luxury** research — marks live in an upper or edge zone; lower area stays empty so type can sit on a solid band.

| File | Mood | Format | Type zone |
|---|---|---|---|
| `plate-margin-arc.png` | Soft arc, upper third | 3:4 | Clear lower band |
| `plate-margin-corners.png` | Corner ticks only | 3:4 | Clear lower band |
| `plate-margin-night.png` | Dark void, faint top wash | 3:4 | Dark type band |
| `plate-margin-dust.png` | Speckle at top | 1:1 | Clear lower band |
| `plate-margin-mist.png` | Mist upper half | 9:16 | Clear lower band |
| `plate-margin-wide.png` | Wash on left third | 16:9 | Clear right / lower band |

### Composition law (non-negotiable)

1. **Split the frame** — art zone + solid type band (≥35% of height). Do not set headlines on top of brushwork.
2. **Object-position top** — plates are authored with empty lower margins; crop from the top.
3. **No stroke through glyphs** — if a mark would cross a letter, move the type or kill the mark.
4. **Billboard series** — same template every time; only plate + line change (2026 billboarding pattern).
5. **Scrim is last resort** — prefer a solid band over frosted overlays.

### Design research we pulled from

| Source pattern | What we took |
|---|---|
| Quiet-luxury / retreat branding | Negative space as the premium signal; calm over spectacle |
| Gallery exhibition posters | Artwork above, title/claim in a clear lower margin |
| Aesop-adjacent organic campaigns | Sparse organic marks, restrained pigment, texture without chaos |
| 2026 “billboarding” | Glanceable series; one-second read in a feed |
| Translucence trend | Acknowledged for depth — but we use solid bands for outcome copy instead of type-on-glass |


### Plate rules

1. **Full-bleed** — the art is the surface, not a card inset.
2. **No figurative cats** in the plate — the disc carries the character.
3. **Texture over gloss** — paper tooth, charcoal dust, ink bloom. Avoid plastic gradients.
4. **Series coherence** — same paper temperature, same charcoal family, so thirteen plates still feel like one studio.
5. **Leave a quiet zone** — every plate needs a soft area for type (corner or band). Story plates keep a quieter lower third; wide plates keep a soft centre or right side.
6. **Never neon** — if a colour appears, it should look like pigment on paper.

### How to commission / generate more

Brief: *“Abstract charcoal and ink on warm off-white paper, dry-brush and bloom, gallery print, no text, no logo, no animals, no neon, [target ratio].”* Keep the Kip logo nearby as a **material reference** (stroke weight / irregularity), not as content to redraw.

When adding plates, name them `plate-{mood}.png` and tag the intended crop in the specimen.

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

### Copy shape — outcome first

Mate voice, poster volume, **life after Kip**:

| Use | Avoid (product mechanics) |
|---|---|
| `SOCIAL’S HANDLED.` | `SEND THE PHOTO.` |
| `OFF YOUR MIND.` | `TEXT KIP.` |
| `POSTED. YOU’RE FREE.` | `APPROVE IN THE THREAD.` |
| `YOU DON’T THINK ABOUT IT.` | `AI CAPTIONS.` |
| `SORTED.` | `SMS SOCIAL MANAGER.` |
| `IT GOES OUT. YOU DON’T.` | `AUTOMATE YOUR WORKFLOW.` |

Whisper lines under the shout should deepen the feeling (“cheap social, completely done”), not explain the stack.

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

1. ~~Lock plate series 01~~ → **Series 01 + 02 locked** (13 plates in `prototype/design-language/plates/`).
2. Export templates from the format kit (story 9:16, feed 1:1, portrait 3:4, OG 16:9).
3. Landing hero: try `edge-bloom` or `single-stroke` + line + disc (keep real shop photo as an alternate mode).
4. Social kit: mix Series 01/02 — at least one story, three feed tiles, one wide OG.
5. Promote this doc into [`DESIGN.md`](DESIGN.md) once approved.

---

## 12. Decision checklist

1. Does the line sell **life after Kip** — or how Kip works?
2. Would a busy owner feel **relief** in under a second?
3. Is the **art** doing the stopping — or did we fall back to neon/UI chrome?
4. Does the plate still feel like the same studio as the cat’s brush?
5. Can you read the line from across the room?
6. Is the disc present and unaltered?
7. Would this still look like Kip on a gallery wall of abstract prints?

---

## Specimen

→ [`prototype/design-language/index.html`](../prototype/design-language/index.html)
