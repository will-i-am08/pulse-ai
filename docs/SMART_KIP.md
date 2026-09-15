# Smart Kip

Make Kip feel sharper without burning Sonnet on every SMS. Route model spend by task difficulty, then layer tools, memory, and a light planner.

Feature flags (all off by default — existing behaviour stays until you flip them):

| Flag | Effect |
|------|--------|
| **`KIP_SMART_ROUTING`** (`true` / `1`) | `callLLM` / `callLLMWithTools` route by tier (fast / standard / smart). |
| **`SMART_MODEL`** | Optional override for smart-tier primary (defaults to `FALLBACK_MODEL`). |
| **`KIP_TOOL_LOOP`** (`true` / `1`) | Question turns use a bounded Anthropic **client tool loop** instead of plain `speakSMS` + web_search. |
| **`KIP_GENERAL_AGENT`** (`true` / `1`) | After hard gates, inbound SMS with no attached media and no pending draft uses retrieve + identity + the general tool loop (`runGeneralAgent`). Off by default. |
| **`KIP_SMART_PLANNER`** (`true` / `1`) | Multi-step owner asks get a short `SmartPlan` before kickoff enqueue (`planSmartTurn` / `parseSmartPlan`). |

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
| **smart** | `SMART_MODEL` \|\| `FALLBACK_MODEL` first (retries) → DRAFT once as last resort. Think, research, strategy, kickoff planning, tool-loop answers, thin planner. |

When the flag is off, tier is ignored for selection (always standard plan) but still logged.

**Wired call sites (orchestrator):** smart — think, speak (when Think ran), research, competitors, ad library, strategy brief, niche plan, autonomy, kickoff plan, smart_answer, smart_plan. fast — classify fallback, conversation summarise, pillar label, open-loops update. standard — draft caption, apply correction (and anything unlabeled defaults to standard).

### Phase 2 — Tool loop (shipped behind `KIP_TOOL_LOOP`)

When `KIP_TOOL_LOOP=true`, `answerQuestion` → `answerWithTools` → `callLLMWithTools` with up to **3** assistant↔tool rounds (`task: smart_answer`, tier `smart`).

**Tools** (`packages/orchestrator/src/agentTools.ts`):

| Tool | Behaviour |
|------|-----------|
| `get_brand_profile` | Connection summary, facts, brand context, voice tone notes. No secrets/tokens. |
| `get_recent_posts` | Recent posts (pending_approval / approved / scheduled / published) with caption excerpts. |
| `get_calendar` | Upcoming committed posts (7–14 days). Notes empty days. Read-only — does not call `scheduleSlot`. |
| `enqueue_kickoff` | Queues `KipKickoffKind` with `reason: user_request`. Never publishes. |
| `remember_fact` | Appends a short entry via `recordKipMemory` under `brand.facts.kip_preferences` or `kip_decisions`. |

Final text is run through `humanizeChat` + `stripMarkdown` for SMS.

**Safety:** enqueue drafts only; no auto-publish; no ad spend; tool results are untrusted data. v1 does **not** mix Anthropic server `web_search` inside the tool loop (custom tools + brand data only).

### Phase 3 — Memory that compounds (shipped)

Persisted `kip_preferences` / `kip_decisions` shape prompts via `kipMemoryPromptBlock` (`packages/orchestrator/src/kipMemory.ts`):

- `readKipPreferences` / `readKipDecisions` / `mergeKipMemoryFact` / `recordKipMemory`
- Injected in **`personaLines`** (so Speak via `buildSpeakSystem`, Think, smart_answer, etc. see prefs) and **`draftCaption`** brand context
- `remember_fact` tool + optional conservative write from `applyCorrection` (`durablePrefFromCorrectionNote` → `kip_preferences` only when the learned note clearly sounds like a durable pref)

### Phase 4 — Thin planner (shipped behind `KIP_SMART_PLANNER`)

When `KIP_SMART_PLANNER=true` and `looksLikeMultiStepAsk(message)`:

1. `planSmartTurn` → `callLLM` (`tier: "smart"`, `task: "smart_plan"`) → `parseSmartPlan`
2. If the plan has a valid `kickoffKind`, `enqueueKickoff` with payload `{ plan, … }` and ack from `speakHint` (or default ack)
3. Wired in `processInbound` before `enqueueKickoffFromUserMessage` (kickoff path) and late on ambiguous **instruction** paths (after specific handlers)
4. Null / low confidence (&lt; 0.45) / flag off → existing behaviour

Never publishes; never invents spend. Max 4 steps.

### Phase 5 — General agent (shipped behind `KIP_GENERAL_AGENT`)

Three layers. The model stays general; tools and retrieval narrow. Content engine (captions, kickoffs, composer, UGC) is **not** rewritten — `draft_copy` is a facade over it.

**Hard gates (existing handlers, no LLM router):** onboarding FSM, destination-link confirm, HOLD, parked carousel/variant picks, pending-draft format cmds, high-confidence approval/edit, engagement/CRM verbs, connect/disconnect, ads toggles, **performance digest**, **calendar lookup**. Attached media still uses the existing photo/video/UGC pipeline. Greetings / thanks / affirmations run **before** the general agent and reply locally (`quickSocialReply` / `quickReengageReply`) — no conversation summarize, no Speak. The gateway also skips the 2.8s inbound coalesce sleep for those complete short turns (and calendar / progress pings) so “hi” is DB + Twilio, not a 10s wait.

When the flag is on and there is **no attached media and no pending_approval draft**, `routeInbound` calls `runGeneralAgent` (after those gates):

1. `retrieveBrandContext` — working set (prefs, facts, strategy, engine including upcoming posts, open loops, compact voice) plus query-selected tone/campaigns. **No conversation summarize LLM.** Logs `{ event: "retrieve", brandId, sections, chars }`. No vector DB.
2. `agentIdentity` — `personaVoiceLines` (not full `personaLines`), who it serves, judgment, escalation. Not a task menu. No photo/font/strategy dump.
3. Last ~6 SMS turns as real `user`/`assistant` messages, then the current inbound.
4. `callLLMWithTools` (`task: general_agent`, tier `smart`, max 4 rounds) with:

| Tool | Behaviour |
|------|-----------|
| `schedule_post` | `scheduleSlot` on a pending/approved/scheduled post. Never sets `published`. |
| `pull_analytics` | `buildPerformanceAnalysis` (read-only). |
| `draft_copy` | Engine facade: `caption`, `post`, `first_batch`, `carousel`, `story`, `trend`, `competitor`, `from_library`, `ugc`, `reel`. Queues drafts / kickoffs only. |
| `check_calendar` | SMS rundown of upcoming committed posts (7–14 days). Read-only. |
| `escalate_to_human` | Structured log + `operatorAlert` → `sendToOperator`. Owner SMS stays in character. |
| `remember_fact` | Short pref/decision on `brand.facts`. |

5. `humanizeChat` + `stripMarkdown`
6. `maybeEnqueueFromKipCommit` safety net if the model promised work without a successful `draft_copy`
7. Fire-and-forget `scheduleOpenLoopsUpdate`. If the owner’s line is a clear durable pref (`prefer` / `always` / `never` / …) and `remember_fact` did not run, `recordKipMemory` without an extra LLM.

Obvious calendar asks (`looksLikeCalendarAsk`) skip retrieve/agent entirely: SQL + `summarizeCalendar` prose. Twilio “Still on this — one sec…” filler only for `looksLikeSlowSmsWork` (kickoff/draft jobs).

Pending + question still uses `runGeneralAgent` via `answerQuestion` (and threads `operatorAlert`). Flag off → today's classify/switch router. `KIP_TOOL_LOOP` question path is unchanged when the general-agent flag is off.

## Acceptance (Phase 0–4)

- [ ] `resolveModelPlan` unit tests green (routing off / on × fast / standard / smart).
- [ ] Existing speak + classify tests still pass.
- [ ] With routing off, behaviour matches pre-change DRAFT → FALLBACK.
- [ ] With routing on, cheap paths never call Sonnet unless you change the fast plan.
- [ ] Logs show `task` + `tier` + `model` without content.
- [ ] `agentTools` tests: remember_fact merge, invalid kickoff kind, brand profile, tool names.
- [ ] With `KIP_TOOL_LOOP` off, question path still uses `speakSMS`.
- [ ] `kipMemory` tests: prompt block + merge.
- [ ] `parseSmartPlan` / `looksLikeMultiStepAsk` tests (no live LLM).
- [ ] With `KIP_SMART_PLANNER` off, kickoffs unchanged.

## Acceptance (Phase 5)

- [ ] Exposed tools are `schedule_post`, `pull_analytics`, `draft_copy`, `check_calendar`, `escalate_to_human`, `remember_fact`.
- [ ] Unknown `draft_copy.job` fails closed with `allowedJobs`.
- [ ] `schedule_post` never writes `status = published`.
- [ ] `retrieveBrandContext` includes banned words / prefs / engine status; keyword overlap ranks matching captions; empty sections stay `(none)`.
- [ ] `agentIdentity` has role + draft_copy-before-SMS judgment + escalation triggers; no tool menu.
- [ ] Flag off → existing inbound path. Flag on after gates → `runGeneralAgent` (no media, no pending). Greetings and calendar asks do not enter the agent.
- [ ] `maybeEnqueueFromKipCommit` still runs after a general-agent reply.
- [ ] Pending+question threads `operatorAlert` to the gateway; does not double-enqueue.
- [ ] `looksLikeCalendarAsk` is true for “what’s on my calendar this week?” and false for draft/ads compound asks.
- [ ] `summarizeCalendar` is SMS prose, not JSON.
- [ ] Slow-work filler is off for calendar / hey; on for draft kickoffs.
- [ ] “hi” / thanks do not call `summarize` or `speak`; gateway `shouldSkipInboundBurst` is true for those and false for “draft me 3”.

## Ops notes

- Flip `KIP_SMART_ROUTING=true` in staging first; watch `llm_call` volume and model mix.
- Flip `KIP_TOOL_LOOP=true` after routing looks healthy — watch `smart_answer` latency and tool error rates.
- Flip `KIP_SMART_PLANNER=true` after tool loop looks healthy — watch `smart_plan` volume and kickoff mix.
- Flip `KIP_GENERAL_AGENT=true` on **Vercel production** (inbound SMS) **and** Railway (kickoff drains), then **redeploy** Vercel so the live function has the env. Watch `general_agent` / `retrieve` logs for non-calendar turns. Simple calendar SMS should **not** log those — it is SQL-only. Leave the flag off in new environments until that is quiet.
- Pin `SMART_MODEL` only if you want smart tier on a different Sonnet/Opus id than `FALLBACK_MODEL`.
- Cost control: leave classify / summarise / open-loops on **fast**; don’t promote them to smart without a reason.
