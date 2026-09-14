# Smart Kip

Make Kip feel sharper without burning Sonnet on every SMS. Route model spend by task difficulty, then layer tools, memory, and a light planner.

Feature flag: **`KIP_SMART_ROUTING`** (`true` / `1`). Off by default — existing DRAFT → FALLBACK behaviour stays until you flip it. Optional **`SMART_MODEL`** overrides the smart-tier primary (defaults to `FALLBACK_MODEL`).

## Phases

### Phase 0 — Instrument `callLLM`

Every orchestrator LLM call can pass `tier` + `task`. On success or final failure, log one structured line:

`{ event: "llm_call", task, tier, model, ok, ms }`

No message content / PII. Use this to see where Haiku vs Sonnet actually runs before turning routing on in prod.

### Phase 1 — Model routing by tier

When `KIP_SMART_ROUTING` is on, `resolveModelPlan(tier, env)` picks the try order:

| Tier | Plan |
|------|------|
| **fast** | `DRAFT_MODEL` only (retries). No Sonnet fallback — predictable cost for classify / summarise / scratchpad. |
| **standard** | Today's behaviour: DRAFT retries → FALLBACK once. Captions, corrections, fillers. |
| **smart** | `SMART_MODEL` \|\| `FALLBACK_MODEL` first (retries) → DRAFT once as last resort. Think, research, strategy, kickoff planning. |

When the flag is off, tier is ignored for selection (always standard plan) but still logged.

**Wired call sites (orchestrator):** smart — think, speak (when Think ran), research, competitors, ad library, strategy brief, niche plan, autonomy, kickoff plan. fast — classify fallback, conversation summarise, pillar label, open-loops update. standard — draft caption, apply correction (and anything unlabeled defaults to standard).

### Phase 2 — Tool loop (not in this ship)

Give smart turns a small tool surface (brand facts, recent posts, research snapshots, calendar) so Sonnet can fetch instead of guessing. Keep tools read-mostly at first; never let web/tool text become instructions.

### Phase 3 — Memory that compounds

Open loops + corrections already exist. Next: durable prefs, “what worked last time,” and citing prior research in Speak without dumping dumps into SMS.

### Phase 4 — Light planner

For multi-step jobs (niche plan → brief → draft), a short plan object before execution — not a free-form agent. Owner still approves spend and publishes.

## Acceptance (Phase 0–1)

- [ ] `resolveModelPlan` unit tests green (routing off / on × fast / standard / smart).
- [ ] Existing speak + classify tests still pass.
- [ ] With routing off, behaviour matches pre-change DRAFT → FALLBACK.
- [ ] With routing on, cheap paths never call Sonnet unless you change the fast plan.
- [ ] Logs show `task` + `tier` + `model` without content.

## Ops notes

- Flip `KIP_SMART_ROUTING=true` in staging first; watch `llm_call` volume and model mix.
- Pin `SMART_MODEL` only if you want smart tier on a different Sonnet/Opus id than `FALLBACK_MODEL`.
- Cost control: leave classify / summarise / open-loops on **fast**; don’t promote them to smart without a reason.
