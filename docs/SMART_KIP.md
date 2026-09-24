# Smart Kip

Make Kip feel sharper without burning Sonnet on every SMS. Route model spend by task difficulty. Owner SMS uses one inbound brain (`runGeneralAgent`) after hard gates.

Feature flags:

| Flag | Effect |
|------|--------|
| **`KIP_SMART_ROUTING`** (`true` / `1`) | `callLLM` / `callLLMWithTools` route by tier (fast / standard / smart). |
| **`SMART_MODEL`** | Optional override for smart-tier primary (defaults to `FALLBACK_MODEL`). |

`KIP_GENERAL_AGENT`, `KIP_TOOL_LOOP`, and `KIP_SMART_PLANNER` are gone. A new environment with no Kip agent flags still hard-gates yes and otherwise runs `runGeneralAgent`. Rollback is git revert of the inbound loop.

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

### Phase 2 — Tool loop (merged into the inbound brain)

`answerWithTools` remains as a helper. Owner SMS leftover turns use `runGeneralAgent` with the same tool family (`task: general_agent`). The old `KIP_TOOL_LOOP` flag is gone.

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

### Phase 4 — Thin planner (retired as a parallel brain)

`planSmartTurn` / `parseSmartPlan` remain as helpers. Compound asks go through `runGeneralAgent` + tools in one turn. The old `KIP_SMART_PLANNER` flag is gone. Never publishes; never invents spend.

### Phase 5 — General agent (default inbound path)

Three layers. The model stays general; tools and retrieval narrow. Content engine (captions, kickoffs, composer, UGC) is **not** rewritten — `draft_copy` and draft-mutation tools are facades over it.

**Hard gates (existing handlers, no LLM router):** HOLD, high-confidence **approval** (`yes` / `looksLikeApproval`) on an offered draft, discard (`CANCEL_RE`), spend/boost/ads confirms, disconnect, suggested-comment send. Quiet hours stay a clock. Setup (contact card / Meta connect) still runs unless they sent a photo or a real draft ask. Old parked 1/2/3 and carousel-or-separate rows can still resolve; new photos do not create those traps.

Photos, kickoffs, greetings, calendar, ideas, digest, brand-recall, plan/link/strategy yes (no pending draft), and fuzzy leftover turns go to `leftoverTurn` / `runGeneralAgent`. The gateway does **not** skip the inbound coalesce sleep for a lone “hey” / thanks — a follow-up SMS may still land.

`routeInbound` calls `runGeneralAgent` after those gates with attached `mediaIds` when present. High-confidence approval with a pending draft does **not** enter the agent — it stays on `approveSelectedDestinations`.

1. `retrieveBrandContext` — working set (prefs, facts, strategy, engine including **offered-draft world model** when pending: caption vs on-image text, source vs styled media, format) plus query-selected tone/campaigns. **No conversation summarize LLM.** Logs `{ event: "retrieve", brandId, sections, chars }`. No vector DB.
2. `agentIdentity` — `personaVoiceLines` (not full `personaLines`), who it serves, judgment (draft_copy for new work; set_image_text vs revise_caption for pending), escalation. Not a task menu. No photo/font/strategy dump.
3. Last ~6 SMS turns as real `user`/`assistant` messages, then the current inbound.
4. `callLLMWithTools` (`task: general_agent`, tier `smart`, max 4 rounds) with:

| Tool | Behaviour |
|------|-----------|
| `schedule_post` | `scheduleSlot` on a pending/approved/scheduled post. Never sets `published`. |
| `pull_analytics` | `buildPerformanceAnalysis` (read-only). |
| `draft_copy` | Engine facade: `caption`, `post`, `first_batch`, `carousel`, `story`, `trend`, `competitor`, `from_library`, `ugc`, `reel`. Queues drafts / kickoffs only. |
| `get_offered_draft` | Structured view of the pending draft (caption ≠ image text). |
| `revise_caption` | Caption-only edit; rejects meta/clarify LLM output. Never publishes. |
| `set_image_text` | Toggle overlay on the image (`enabled=false` restores `source_media_ids[0]`, clears `wants_text`). Caption unchanged. |
| `restyle_image` | Flux/edit from source; re-tiles only if `wants_text` was already true. |
| `regenerate_creative` | Reject offered draft + queue `draft_posts` kickoff. |
| `reject_draft` | Discard pending draft. |
| `check_calendar` | SMS rundown of upcoming committed posts (7–14 days). Read-only. |
| `escalate_to_human` | Structured log + `operatorAlert` → `sendToOperator`. Owner SMS stays in character. |
| `remember_fact` | Short pref/decision on `brand.facts`. |
| `scout_ideas` | Ideas only — refuses draft-shaped asks. |
| `confirm_pending_ask` | Accept/reject plan, booking link, strategy, organic campaign, perf mix. Never publishes. Never first_batch. |

5. `humanizeChat` + `stripMarkdown`; optional `mediaUrl` from mutation tools for MMS preview
6. `maybeEnqueueFromKipCommit` safety net if the model promised work without a successful `draft_copy`
7. Fire-and-forget `scheduleOpenLoopsUpdate`. If the owner’s line is a clear durable pref (`prefer` / `always` / `never` / …) and `remember_fact` did not run, `recordKipMemory` without an extra LLM.

Calendar / ideas / digest / brand-recall / photo briefs use the same leftover path. Twilio “Still on this — one sec…” filler only for `looksLikeSlowSmsWork` (kickoff/draft jobs).

The general agent is the default inbound path after hard gates. High-confidence approval with a pending draft does **not** enter the agent.

## Acceptance (Phase 0–4)

- [ ] `resolveModelPlan` unit tests green (routing off / on × fast / standard / smart).
- [ ] Existing speak + classify tests still pass.
- [ ] With routing off, behaviour matches pre-change DRAFT → FALLBACK.
- [ ] With routing on, cheap paths never call Sonnet unless you change the fast plan.
- [ ] Logs show `task` + `tier` + `model` without content.
- [ ] `agentTools` tests: remember_fact merge, invalid kickoff kind, brand profile, tool names.
- [ ] `kipMemory` tests: prompt block + merge.
- [ ] `parseSmartPlan` / `looksLikeMultiStepAsk` tests (no live LLM).

## Acceptance (Phase 5)

- [ ] Exposed tools include `schedule_post`, `pull_analytics`, `draft_copy`, `get_offered_draft`, `revise_caption`, `set_image_text`, `restyle_image`, `regenerate_creative`, `reject_draft`, `check_calendar`, `escalate_to_human`, `remember_fact`, `confirm_pending_ask`.
- [ ] Unknown `draft_copy.job` fails closed with `allowedJobs`.
- [ ] `schedule_post` never writes `status = published`.
- [ ] `set_image_text(false)` restores source media, sets `wants_text=false`, does not re-apply tile; caption unchanged.
- [ ] `revise_caption` / `looksLikeMetaCaption` never persist clarifying questions as captions.
- [ ] `retrieveBrandContext` includes banned words / prefs / engine status + offered-draft world model when pending; empty sections stay `(none)`.
- [ ] `agentIdentity` has role + draft_copy / set_image_text judgment + escalation triggers; no tool menu.
- [ ] After hard gates → `runGeneralAgent` (photos included; pending allowed; kickoffs allowed; approval excluded).
- [ ] `maybeEnqueueFromKipCommit` still runs after a general-agent reply.
- [ ] `looksLikeCalendarAsk` is true for “what’s on my calendar this week?” and false for draft/ads compound asks.
- [ ] `summarizeCalendar` is SMS prose, not JSON.
- [ ] Slow-work filler is off for calendar / hey; on for draft kickoffs.
- [ ] Gateway `shouldSkipInboundBurst` is **false** for a lone “hi” / thanks (wait for a follow-up) and false for “draft me 3”. Calendar / progress pings still skip.

## Ops notes

- Flip `KIP_SMART_ROUTING=true` in staging first; watch `llm_call` volume and model mix.
- Pin `SMART_MODEL` only if you want smart tier on a different Sonnet/Opus id than `FALLBACK_MODEL`.
- Cost control: leave classify / summarise / open-loops on **fast**; don’t promote them to smart without a reason.
- Watch `general_agent` / `retrieve` logs. Pending-draft edits (“remove the text”) go through agent tools (`set_image_text`). Yes on an offered draft stays a hard gate.
