# Smart Kip

Make Kip feel sharper without burning Sonnet on every SMS. Route model spend by task difficulty, then layer tools, memory, and a light planner.

Feature flags (all off by default — existing behaviour stays until you flip them):

| Flag | Effect |
|------|--------|
| **`KIP_SMART_ROUTING`** (`true` / `1`) | `callLLM` / `callLLMWithTools` route by tier (fast / standard / smart). |
| **`SMART_MODEL`** | Optional override for smart-tier primary (defaults to `FALLBACK_MODEL`). |
| **`KIP_TOOL_LOOP`** (`true` / `1`) | Question turns use a bounded Anthropic **client tool loop** instead of plain `speakSMS` + web_search. |

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
| **smart** | `SMART_MODEL` \|\| `FALLBACK_MODEL` first (retries) → DRAFT once as last resort. Think, research, strategy, kickoff planning, tool-loop answers. |

When the flag is off, tier is ignored for selection (always standard plan) but still logged.

**Wired call sites (orchestrator):** smart — think, speak (when Think ran), research, competitors, ad library, strategy brief, niche plan, autonomy, kickoff plan, smart_answer. fast — classify fallback, conversation summarise, pillar label, open-loops update. standard — draft caption, apply correction (and anything unlabeled defaults to standard).

### Phase 2 — Tool loop (shipped behind `KIP_TOOL_LOOP`)

When `KIP_TOOL_LOOP=true`, `answerQuestion` → `answerWithTools` → `callLLMWithTools` with up to **3** assistant↔tool rounds (`task: smart_answer`, tier `smart`).

**Tools** (`packages/orchestrator/src/agentTools.ts`):

| Tool | Behaviour |
|------|-----------|
| `get_brand_profile` | Connection summary, facts, brand context, voice tone notes. No secrets/tokens. |
| `get_recent_posts` | Recent posts (pending_approval / approved / scheduled / published) with caption excerpts. |
| `get_calendar` | Upcoming committed posts (7–14 days). Notes empty days. Read-only — does not call `scheduleSlot`. |
| `enqueue_kickoff` | Queues `KipKickoffKind` with `reason: user_request`. Never publishes. |
| `remember_fact` | Appends a short entry under `brand.facts.kip_preferences` or `kip_decisions`. |

Final text is run through `humanizeChat` + `stripMarkdown` for SMS.

**Safety:** enqueue drafts only; no auto-publish; no ad spend; tool results are untrusted data. v1 does **not** mix Anthropic server `web_search` inside the tool loop (custom tools + brand data only).

### Phase 3 — Memory that compounds

Open loops + corrections already exist. `remember_fact` is a thin start. Next: durable prefs, “what worked last time,” and citing prior research in Speak without dumping dumps into SMS.

### Phase 4 — Light planner

For multi-step jobs (niche plan → brief → draft), a short plan object before execution — not a free-form agent. Owner still approves spend and publishes.

## Acceptance (Phase 0–2)

- [ ] `resolveModelPlan` unit tests green (routing off / on × fast / standard / smart).
- [ ] Existing speak + classify tests still pass.
- [ ] With routing off, behaviour matches pre-change DRAFT → FALLBACK.
- [ ] With routing on, cheap paths never call Sonnet unless you change the fast plan.
- [ ] Logs show `task` + `tier` + `model` without content.
- [ ] `agentTools` tests: remember_fact merge, invalid kickoff kind, brand profile, tool names.
- [ ] With `KIP_TOOL_LOOP` off, question path still uses `speakSMS`.

## Ops notes

- Flip `KIP_SMART_ROUTING=true` in staging first; watch `llm_call` volume and model mix.
- Flip `KIP_TOOL_LOOP=true` after routing looks healthy — watch `smart_answer` latency and tool error rates.
- Pin `SMART_MODEL` only if you want smart tier on a different Sonnet/Opus id than `FALLBACK_MODEL`.
- Cost control: leave classify / summarise / open-loops on **fast**; don’t promote them to smart without a reason.
