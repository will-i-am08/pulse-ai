# Kip Personalisation & Proactiveness — Build Spec

**Status:** proposed · **Branch:** `claude/kip-personalization-proactiveness`
**Goal:** Give every owner a Kip that (a) remembers the specifics of *their world* and follows up on them unprompted, and (b) proactively engages at a level tuned to that owner — quiet for some, high-touch for others — so proactivity feels like a good manager, never a nagging bot.

The north-star moment is the "Lindy" reply to a bare *"hi"*:

> Hey Will — been a minute. How'd the Emily Calder shoot go? Want your morning report?

Two capabilities produce that line: **episodic event memory** (the shoot) and a **per-owner engagement profile** (does this owner want a morning report at all). This spec delivers both across three phases.

---

## 0. What already exists (do not rebuild)

| Capability | Where | Notes |
|---|---|---|
| Persona / named address | `packages/orchestrator/src/persona.ts` | `personaLines(brand)`, `ownerFirstName(brand)` |
| Durable prefs/decisions | `packages/orchestrator/src/kipMemory.ts` | `brand.facts.kip_preferences[]`, `kip_decisions[]` |
| Open-loop scratchpad | `packages/orchestrator/src/speak/openLoops.ts` | `waiting_on / promised / prefs / energy`, updated fire-and-forget each turn |
| Gap / re-engagement | `packages/orchestrator/src/reengagement.ts` | `gapInfo()`, `lastInteractionAt()`, `mostRecentActionable()`; `reengage()` in `processInbound.ts:580` |
| Business facts extraction | `packages/orchestrator/src/businessProfile.ts` | `updateFactsFromMessage()` — LLM extract → merge → `update brands set facts` |
| Proactive triggers (cron) | `apps/worker/src/triggers/*` | `proactive_triggers` table, `runTriggerLoop()` every minute, `isTriggerDue()` |
| Proactive worker fleet | `apps/worker/src/proactive/*` | checkin, weeklyDigest, competitorWatch, autonomyLoop, connectNudge, chase, gapFill, creativeRefresh |
| Proactive kickoffs | `packages/orchestrator/src/kickoffs.ts`, `autonomy.ts` | `enqueueKickoff()`; 24h throttle on `reason='proactive'` |

**Key mechanics the new work must reuse, not reinvent:**

- Facts persistence: `update brands set facts = $1::jsonb where id = $2` with `JSON.stringify(merged)`. Always read-modify-write the whole `facts` blob.
- Proactive send: `sendToBrand(brandId, body)` from `@pulse/gateway`.
- Daytime / quiet-hours gate: `isDaytime(now)` from `@pulse/gateway`. Every proactive send passes through it.
- Global proactive throttle already used by autonomy: **≤1 proactive outbound per brand per 24h**. New proactive loops must respect the *same* budget, not add a parallel one (see §4.4 and §5.4).

---

## 1. Data model additions

All additive, all on `brand.facts` (jsonb) so no column migration and old rows still parse. Define zod schemas in `packages/shared/src/types.ts` next to `open_loops`, and extend the `BusinessFacts` interface (types.ts:792).

### 1.1 Episodic events

```ts
export const kipEventSchema = z.object({
  id: z.string(),                      // nanoid, for dedupe + follow-up marking
  summary: z.string(),                 // "photoshoot for Emily Calder"
  entity: z.string().default(""),      // proper-noun anchor: "Emily Calder" (for the callback line)
  kind: z.enum(["shoot", "launch", "event", "meeting", "trip", "deadline", "personal", "other"]).default("other"),
  when_iso: z.string().nullable(),     // resolved date/time if given ("Friday" → ISO), else null
  when_text: z.string().default(""),   // raw phrase as owner said it ("this Friday")
  created_at: z.string(),
  followed_up_at: z.string().nullable().default(null), // set once Kip has asked about it
  status: z.enum(["upcoming", "passed", "closed"]).default("upcoming"),
});
export type KipEvent = z.infer<typeof kipEventSchema>;
```

On `BusinessFacts`:

```ts
/** Named things happening in the OWNER's world that Kip should recall + follow up on. */
kip_events?: KipEvent[];   // cap 30, evict oldest closed first
```

### 1.2 Engagement profile (the per-user dial)

```ts
export const engagementProfileSchema = z.object({
  proactivity: z.enum(["quiet", "balanced", "high"]).default("balanced"),
  warmth: z.enum(["crisp", "friendly", "matey"]).default("friendly"),
  report: z.object({
    cadence: z.enum(["off", "daily", "weekly"]).default("weekly"),
    hour_local: z.number().int().min(0).max(23).default(8),
  }).default({}),
  // Learned engagement, not owner-set. -1..+1 rolling score per proactive channel.
  affinity: z.record(z.string(), z.number()).default({}), // e.g. { checkin: -0.4, competitor: 0.6, event_followup: 0.8 }
  source: z.enum(["default", "owner_set", "learned"]).default("default"),
  updated_at: z.string().default(""),
}).default({});
export type EngagementProfile = z.infer<typeof engagementProfileSchema>;
```

On `BusinessFacts`:

```ts
/** How proactive / warm / frequent Kip should be for THIS owner. */
engagement_profile?: EngagementProfile;
```

Reader helper (mirror `readOpenLoops`) in a new `packages/orchestrator/src/engagementProfile.ts`:

```ts
export function readEngagementProfile(brand): EngagementProfile   // parse with defaults, never throw
```

---

## 2. Phase 1 — Episodic event memory + follow-up

**Outcome:** Kip captures named events from owner messages, recalls them in conversation, and — once they've passed — asks how they went, exactly once, inside the existing proactive budget.

### 2.1 Capture — `packages/orchestrator/src/eventMemory.ts` (new)

- `export async function extractEventsFromMessage(brand, message): Promise<KipEvent[]>`
  - One `callLLM` call, `maxTokens ≤ 300`, JSON-only. System prompt: *"Extract concrete upcoming or just-happened events in the OWNER's own life/business that a good manager would follow up on (shoots, launches, trips, meetings, deadlines, personal milestones). For each: summary, entity (the proper noun if any), kind, and resolve relative dates (today is {localDate}, tz {tz}) to when_iso plus keep when_text. Ignore vague plans and anything already about a draft/post/schedule. Output {"events":[]} if none."*
  - Pass today's local date + `brand` tz (reuse the `DEFAULT_TZ`/`localYmd` helpers already in `reengagement.ts`).
- `export async function rememberEvents(brand, events): Promise<void>`
  - Read-modify-write `facts.kip_events`, assign `id` (nanoid) + `created_at`, dedupe by normalised `summary`+`when_iso`, cap 30, `update brands set facts`.

**Wiring:** in `processInbound.ts`, alongside the existing `looksLikeBusinessFact` / `updateFactsFromMessage` path (~line 2238). Run **fire-and-forget after the reply is sent** (like `updateOpenLoopsAfterTurn` at openLoops.ts:126) so it never blocks or delays the owner's reply. Gate behind a cheap signal to avoid an LLM call on every message — a regex for future/past-time + capitalised-noun cues (extend the `FACT_SIGNAL` style in `businessProfile.ts`); if it looks like it *might* mention an event, run the extractor.

### 2.2 Recall in conversation — surface as a callback

Add `eventsPromptBlock(facts)` to `eventMemory.ts` (mirrors `kipMemoryPromptBlock` / `openLoopsPromptBlock`): lists ≤3 upcoming + ≤2 recently-passed events as *"On {entity}'s {kind} — {when_text}"*, prefixed *"React to these naturally when relevant; never dump as a list."* Inject it:

1. into `personaLines()` (persona.ts) via the same pattern as `kipMemoryPromptBlock`, **and**
2. specifically into the `reengage()` path (processInbound.ts:580) so a cold-open *"hi"* after a gap can lead with the single most relevant callback. The reengage Speak call should be told: *"If a passed event is un-followed-up, open by asking how it went."*

### 2.3 Follow-up loop — `apps/worker/src/proactive/eventFollowup.ts` (new)

Runs on `guardedInterval` from `apps/worker/src/index.ts`, every ~30 min (align with existing proactive loop cadence).

```
for each active brand with facts.kip_events:
  find events where status != 'closed'
    and followed_up_at is null
    and when_iso is in the past by ≥ 3h (grace so we don't ask mid-event)
    and not older than 14 days (stale → mark closed silently)
  pick at most ONE (soonest-passed first)
  if none → continue
  if !isDaytime(now) → skip (retry next tick)
  if brand is over the shared proactive budget (§2.4) → skip
  compose a warm one-liner via Speak (mode "reengage"/"checkin", persona + the event):
    "morning Will — how'd the Emily Calder shoot go?"
  sendToBrand(); set event.followed_up_at = now, status = 'passed'; persist
```

Dedupe/idempotency: setting `followed_up_at` before/at send time under the read-modify-write guarantees one ask per event. If the send fails, leave `followed_up_at` null to retry (bounded by the 14-day staleness rule).

### 2.4 Shared proactive budget

Do **not** invent a new throttle. Extend the autonomy check (`recentlyProactive()` in `autonomy.ts`) into a shared helper — `packages/orchestrator/src/proactiveBudget.ts`:

```ts
export async function canSendProactive(brandId, now): Promise<boolean>
export async function recordProactiveSend(brandId, channel, now): Promise<void>
```

Back it with a lightweight `proactive_sends(brand_id, channel, sent_at)` table (new migration) so **all** proactive channels — event follow-up, checkin, competitor, autonomy kickoffs — draw from one ≤1/24h (balanced) budget and we can attribute engagement later (Phase 3). Migrate `autonomy.ts` to use it too. **Number the migration against `origin/main` first** (see the deploy memory — migration-number collisions).

### 2.5 Tests (`packages/orchestrator/src/__tests__`, `apps/worker/src/proactive/__tests__`)

- Extractor: "shooting Emily Calder Friday" → one event, entity `Emily Calder`, `when_iso` = the coming Friday; "post a reel Friday" → **no** event (it's a content task, not a life event).
- Recall block: renders upcoming + passed, empty string when none.
- Follow-up loop (deps-injected, like `checkin.test.ts`): fires once for a passed un-followed event; skips future events; skips outside daytime with no mark; respects budget; marks stale >14d closed without sending; idempotent across two ticks.

---

## 3. Phase 2 — Engagement profile (dials) + explicit control

**Outcome:** Every proactive behaviour and the persona tone read a per-owner profile. Owner can change it in plain language.

> **Status (built):** schema + `readEngagementProfile`; NL control (`looksLikeEngagementPref` / `updateEngagementFromMessage`) wired into `processInbound` ahead of the business-fact path; persona tone (`engagementToneLines`); gating primitives (`shouldRunProactive`, `proactiveBudgetFor`) wired into **check-in** (quiet → skip), **weekly digest / report** (cadence off → skip) and **autonomy** (quiet → no trend/competitor drafts). Inert at the `balanced` default, so existing behaviour and tests are unchanged.
>
> **Remaining Phase 2 wiring (follow-up):** report `hour_local` + `daily` cadence needs the trigger schedule to honour the chosen hour (currently the digest still fires Monday late-morning); `high` → 2×/week check-in and the autonomy budget bump to 2/24h (autonomy still uses its own 1/24h kickoff throttle); competitorWatch loop quiet-gate. None block the dial's core behaviour.

### 3.1 Explicit NL control — `packages/orchestrator/src/engagementProfile.ts`

- `looksLikeEngagementPref(body)` — regex signal: *ease off, stop messaging, too much, more often, check in daily, morning report, quiet, leave me alone, hit me up, keep me posted*, report-time phrases.
- `updateEngagementFromMessage(brand, message): Promise<string | null>` — same shape as `updateFactsFromMessage`: LLM maps the message to `{proactivity?, warmth?, report?}` deltas + a one-line confirm; merge onto `facts.engagement_profile`, set `source='owner_set'`, persist; return the confirm (or null if nothing engagement-related). Wire into `processInbound.ts` **before** the generic fact path so "stop checking in so much" is caught as a preference, not a business fact.

### 3.2 Gating the proactive fleet

Each proactive loop reads `readEngagementProfile(brand)` and honours it **before** composing:

| Loop | `quiet` | `balanced` (default) | `high` |
|---|---|---|---|
| eventFollowup | on (it's owner's own world) | on | on |
| checkin | off | weekly (current) | 2×/week |
| weeklyDigest / report | per `report.cadence` (`off` → skip) | `report.cadence` | `report.cadence`, allow `daily` |
| autonomyLoop kickoffs | off (draft only, no unsolicited text) | 1/24h (current) | up to 2/24h |
| competitorWatch | off | current | current + faster |

`report.hour_local` replaces the fixed digest hour: the report/digest trigger should fire near the owner's chosen local hour (compute via the existing tz helpers).

Implementation: a single guard `shouldRunProactive(channel, profile): boolean` + `proactiveBudgetFor(profile): number` in `proactiveBudget.ts`, called at the top of each loop's per-brand body. Minimises per-loop churn.

### 3.3 Persona modifier

Add `engagementToneLines(profile)` to `persona.ts`, appended in `personaLines()`:
- `warmth=crisp` → *"Keep it short and businesslike; skip the small talk."*
- `warmth=matey` → *"Lean warm and familiar; a bit of banter is welcome."*
- `friendly` (default) → no extra line (current behaviour).

### 3.4 Defaults & back-compat

Absent `engagement_profile` ⇒ `readEngagementProfile` returns `balanced/friendly/weekly@8` — i.e. **exactly today's behaviour**. Phase 2 is inert until an owner or Phase 3 moves a dial. No migration, no backfill.

### 3.5 Tests

- `updateEngagementFromMessage`: "ease off the check-ins" → `proactivity: quiet, source: owner_set`; "send me a morning report at 7" → `report.cadence: daily, hour_local: 7`; "what are your hours" → null (falls through to business facts).
- Gating: `quiet` profile ⇒ checkin loop no-ops; `high` ⇒ budget = 2; missing profile ⇒ identical to current tests.
- Persona: tone line present/absent per warmth.

---

## 4. Phase 3 — The learning loop (earn the dial)

**Outcome:** Kip adjusts proactivity from real behaviour — conservatively, defaulting quiet-ish and earning the right to be chattier.

> **Status (built):** `engagementLearn.ts` — pure `computeChannelSignals` (reply-within-24h vs. no-reply-after-48h → ±1 per channel), `updateAffinity` (EMA 0.7 old / 0.3 new, clamped), `decideDialChange` (down needs ≥2 disliked channels, up caps at balanced, owner_set never touched, one step per run), and `learnEngagementForBrand` (fetch + optional persist via `jsonb_set`). Daily worker loop `proactive/engagementLearn.ts`, gated by `KIP_ENGAGEMENT_LEARN` = `off | log | on` (log-only computes + logs without writing). Check-in and weekly-digest now call `recordProactiveSend` (channels `checkin` / `report`), so with event-followup the learner has 2–3 channels to read. Tests: engine + loop, all green.
>
> **Rollout:** run `KIP_ENGAGEMENT_LEARN=log` for ~a week, eyeball the "would apply" logs, then flip to `on`.

### 4.1 Signals

From data we already have + the `proactive_sends` table (§2.4):
- **Positive:** owner replies within 24h of a proactive send; owner asks for a report/digest; owner approves a proactive draft/kickoff.
- **Negative:** proactive send with no reply and no related action within 48h; owner says an "ease off" phrase (already handled in §3.1, but also feeds the score).

Attribution: join `proactive_sends.channel` to the next inbound / approval per brand. Keep it coarse — a per-channel rolling affinity in `engagement_profile.affinity` updated by exponential moving average (`new = 0.7*old + 0.3*signal`, signal ∈ {-1,+1}).

### 4.2 Job — `apps/worker/src/proactive/engagementLearn.ts` (new)

Daily (`node-cron`, off-peak). For each active brand:
1. Compute per-channel signals over the last N sends.
2. Update `affinity` via EMA.
3. **Only if `source !== 'owner_set'`** (never override an explicit owner choice), nudge dials:
   - mean affinity `< -0.3` for ≥2 channels ⇒ step `proactivity` down one notch (high→balanced→quiet).
   - mean affinity `> +0.4` and owner replies fast ⇒ step **up** one notch, capped at `balanced` unless they've explicitly opted higher. **The learner never auto-escalates to `high`** — that stays owner-only. Set `source='learned'`.
4. Persist. Log every change (auditability: we're changing how often we text a paying customer).

### 4.3 Policy guardrails (non-negotiable)

- Default new brands to `balanced`, not `high`.
- Down-adjust fast (one bad week), up-adjust slow (sustained positive).
- Owner's explicit setting is a hard ceiling/floor the learner can't cross.
- One dial-step per run maximum — no whiplash.

### 4.4 Tests

- EMA math; owner_set is never overwritten; sustained negatives step down and stop at quiet; positives cap at balanced; single-step-per-run invariant.

---

## 5. Safety & the creepiness / mute line

Alfred's standing caution, encoded:
- **Only recall what the owner told Kip in chat.** Never surface inferred or scraped facts as if remembered. The extractor reads owner messages only.
- **Over-proactive → muted number → churn.** The per-user dial *is* the safety mechanism; ship Phase 2's `quiet` path and the shared budget with Phase 1, even though the learner comes later.
- **Every proactive send** passes `isDaytime` + `canSendProactive` before composing.
- **One follow-up per event, ever.** `followed_up_at` enforces it.
- Personal-life events (`kind: personal`) get a lighter touch — a warm one-liner, never a business pivot in the same breath.

---

## 6. Sequencing & flags

1. **Phase 1** ships first and standalone — it's the visible magic and needs only `kip_events` + one loop + the shared budget. Feature-flag the follow-up loop (`KIP_EVENT_FOLLOWUP=on`) for a soak on your own brand before wider rollout.
2. **Phase 2** next — inert by default, so safe to merge; unlocks owner control immediately and gates the fleet.
3. **Phase 3** last — flag `KIP_ENGAGEMENT_LEARN=on`, run in log-only mode first (compute + log intended changes without applying) for a week, then enable writes.

Migrations: only `proactive_sends` (§2.4). Everything else rides `brand.facts`. Check `origin/main` migration numbering before adding it, and apply by hand after merge (per deploy runbook).

---

## 7. Why this is worth building (the commercial read)

This is the **retention and LTV lever**, not a feature. A manager that remembers your shoot and chases the ball unprompted lifts the value equation on both halves — perceived likelihood up, owner effort down — which is exactly what keeps a monthly SMS product from being cancelled. It's the word-of-mouth line ("my Kip remembered my client's name") and the foundation for a premium high-touch **Concierge** tier once the dial exists. Build the one engine; resist scattering into ten new loops.

---

## 8. Open decisions for Will

- **Concierge tier now or later?** The `high` proactivity path is the natural upsell — do we expose it as a paid tier at launch or keep all dials free until retention data justifies the split?
- **Personal-life events — in or out?** Following up on a *business* shoot is unambiguously welcome. Following up on "I'm on holiday next week" is warmer but riskier. Recommendation: include, `personal` kind, lightest touch, and let the learner pull it back per owner.
- **Report default hour:** 8am local assumed. Confirm.
