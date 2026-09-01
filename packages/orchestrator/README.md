# @pulse/orchestrator

Workstream B. Implements the frozen `@pulse/orchestrator` interface from
`docs/BUILD_CONTRACTS.md`: `processInbound`, `draftCaption`, `applyCorrection`,
`seedBrandVoice`, `buildConversationContext`.

## Design

- **`src/llm.ts`** — single `callLLM()` chokepoint for every Anthropic call.
  Reads `DRAFT_MODEL` / `FALLBACK_MODEL` from `getServerEnv()` (never
  hardcoded). Retries the primary model twice with exponential backoff, then
  makes one attempt on the fallback model before giving up.
- **`src/classify.ts`** — two-stage classification. A cheap deterministic
  pass (`ruleBasedClassify`) handles the large majority of real SMS traffic
  (media presence, plain approvals, question shape, edit-signal words) with
  no LLM call. Anything genuinely ambiguous falls through to one `callLLM`
  call that must return strict JSON (`{classification, confidence,
  reasoning}`); malformed output or a failed call is treated as low
  confidence `other`, never guessed.
- **`src/processInbound.ts`** — dispatches on the classification. Confidence
  below `0.55` short-circuits to a clarification reply before any DB write
  beyond persisting the classification itself.
- **`src/draftCaption.ts`** — loads brand + strategy notes + media rows,
  builds a system prompt encoding tone/dos/donts/banned words/emoji &
  hashtag policy/learned notes/examples, and returns a caption plus a
  heuristic `proposedTime` (scans `strategy_notes.best_times` for any
  `HH:MM` strings and proposes the next upcoming one; `null` if none
  configured).
- **`src/applyCorrection.ts`** — records the before/after pair in
  `corrections`, then makes one LLM call to summarise the delta into a
  reusable style rule appended to `brand_voice_profile.notes` (validated via
  `brandVoiceProfileSchema` before saving).
- **`src/seedBrandVoice.ts`** — leniently coerces onboarding answers
  (snake_case or camelCase keys) into `BrandVoiceProfile` + a
  `strategy_notes` upsert.
- **`src/conversationContext.ts`** — last N messages (default 15)
  formatted; if more history exists beyond `SUMMARISE_THRESHOLD` (30), older
  messages are condensed into a short rolling summary via one LLM call
  instead of ever growing unbounded.

## Assumptions / notes for the integrator

- **`messages.type` has no `'edit'` value** (see `0001_init.sql`'s check
  constraint — only `media|instruction|approval|question|other`). The
  orchestrator classifies internally into six categories including `"edit"`,
  but persists it to the DB as `"instruction"` (see
  `toDbMessageType` in `processInbound.ts`).
- On an inbound **edit**, `processInbound` calls `applyCorrection` (records
  the correction + folds the learning into brand voice) *and* updates
  `posts.caption` to the revised text so the draft actually reflects the
  edit — it does **not** touch `posts.status`. Setting `status='approved'`
  after an edit is left to the dashboard/worker, per the contract.
- `draftCaption`'s `proposedTime` heuristic is intentionally simple (regex
  scan for `HH:MM` strings in the free-form `best_times` jsonb). If the
  dashboard onboarding form settles on a stricter `best_times` shape, this
  heuristic can be tightened without changing the public signature.
- `applyCorrection` is also the function the dashboard should call on its
  own edit-then-approve flow (`docs/BUILD_CONTRACTS.md` § D), so it does
  not assume it's only ever invoked from `processInbound`.
- All DB access goes through `serviceClient()` from `@pulse/shared`, always
  filtered by `brand_id`.
- `processInbound` never sets a post to `publishing`/`published` — only
  `pending_approval` (on draft) or `approved` (on a plain approval word),
  each with a matching `approval_log` row, per the "approval is absolute"
  rule.

## Not done here (out of scope for this workstream)

- No `pnpm install` was run — `node_modules` doesn't exist yet, so this
  hasn't been type-checked or test-run in this environment. Run
  `pnpm install && pnpm --filter @pulse/orchestrator typecheck && pnpm
  --filter @pulse/orchestrator test` once wired into the workspace.
  `@anthropic-ai/sdk` is pinned to `^0.32.1` as a placeholder — confirm/bump
  to whatever's current at install time.
- No changes were made outside `packages/orchestrator/`.
