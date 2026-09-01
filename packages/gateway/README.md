# @pulse/gateway

Routes inbound provider messages to the right brand, persists them, captures media into
Supabase Storage, hands off to `@pulse/orchestrator`, and sends replies back out.

- `handleInbound(inbound)` — resolve brand by phone → capture media → persist the inbound
  `messages` row (with `media_ids` from the captured media) → `processInbound()` →
  `sendToBrand()` the reply. Unknown sender or any internal failure never throws; it logs
  and returns `{ brandId: null, messageId: null }`.
- `resolveBrandByPhone(from)` — looks up `brands` by `client_phone`.
- `captureMedia(brandId, channel, media)` — downloads each media item via the channel's
  `fetchMedia` (never trusts the provider's short-lived URL beyond that download), uploads
  to `MEDIA_BUCKET` under `${brandId}/${uuid}.${ext}`, and inserts a `media_assets` row per
  item (`kind` inferred as `video` when the content type starts with `video/`, else `photo`).
  A single failed item is logged and skipped rather than failing the whole batch.
- `sendToBrand(brandId, body, mediaUrls?)` — sends via `activeChannel()` and logs an
  outbound `messages` row.
- `activeChannel()` — singleton `MessageChannel`, currently `createTwilioChannel()` from
  `@pulse/channel-twilio`.
- `withBackoff(fn, opts?)` — retry-with-backoff helper (exponential delay + jitter, default
  3 attempts) used to wrap every external call: Twilio send, media fetch, and Storage upload.

## Tests

`pnpm --filter @pulse/gateway test` (vitest) — covers `withBackoff` (immediate success,
retry-then-succeed, exhausted retries).

## Notes for the integrator

- Depends on `@pulse/orchestrator` (`processInbound`) by name per `docs/BUILD_CONTRACTS.md`.
  That package doesn't exist on disk yet (Workstream B), so `typecheck`/install for this
  package will fail until `packages/orchestrator/` lands with a matching `@pulse/orchestrator`
  `package.json`.
- `handleInbound` captures media *before* inserting the inbound `messages` row so that row's
  `media_ids` can be populated in the same insert, rather than persisting first and
  back-filling `media_ids` afterwards. Functionally equivalent to the contract's prose order;
  flag if a different ordering is required (e.g. persisting a bare row first for durability
  even if media capture fails).
- `messages.type` is left `null` on insert — classification (approval/edit/media/question/
  instruction) is explicitly the orchestrator's job per `BUILD_CONTRACTS.md`.
- Assumes the Supabase Storage bucket named by `MEDIA_BUCKET` (`brand-media`) already exists
  and the service-role key has write access; this package does not create the bucket.
