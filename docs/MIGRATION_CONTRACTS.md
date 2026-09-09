# Supabase → Neon migration — build contract

> **✅ COMPLETED (historical).** The migration is done: the codebase runs on Neon
> Postgres with a single-operator password gate and media served from `/api/media/[id]`.
> No `@supabase/*` imports remain. Kept as a record of the work; not a live task list.

We are moving off Supabase to **Neon Postgres**. `@pulse/shared` is already migrated.
Your job: refactor your owned package so it uses the new seam and has **zero**
`@supabase/*` imports left. Behaviour stays identical; only the data/auth/storage
mechanism changes.

## The new seam (in `@pulse/shared`, done — import from `@pulse/shared`)
```ts
import { db, query, queryOne, putMedia, getMedia, publicMediaUrl } from "@pulse/shared";

// query: all rows;  queryOne: first row or null. Params are $1,$2,… (never string-interpolate).
const brands = await query<Brand>("select * from brands where status = $1", ["active"]);
const brand  = await queryOne<Brand>("select * from brands where client_phone = $1", [from]);
```
- **Remove** every `serviceClient()` / `MEDIA_BUCKET` usage and every `@supabase/*`
  dependency from your package.json.
- The old Supabase query-builder calls (`.from().select().eq()…`) become SQL.

### SQL rules (Postgres via `pg`)
- **jsonb params must be stringified**: `["...", JSON.stringify(profile)]` with `$n::jsonb` in the SQL. Reading jsonb returns a parsed JS object already.
- **uuid[] params**: pass a JS `string[]` and cast in SQL: `$1::uuid[]` (e.g. `media_ids`).
- **counts**: `count(*)` comes back as a **string** (bigint) — `Number(row.count)`.
- **timestamps** already come back as strings (pool sets that) — matches the row types in `@pulse/shared`.
- Insert then read back with `... returning *` (or `returning id`).
- Always filter by `brand_id` — brand isolation is enforced in code (no RLS on Neon).

## Media storage (replaces Supabase Storage)
Bytes live in Postgres (`media_blobs`). Use the shared helpers:
- `putMedia(mediaId, bytes, contentType)` — store.
- `getMedia(mediaId)` → `{ bytes, contentType } | null` — read.
- `publicMediaUrl(mediaId)` → the public URL Meta fetches when publishing
  (`${APP_BASE_URL}/api/media/{id}`).
Flow: a `media_assets` row is inserted first (its `id` is the `media_id`), then
`putMedia(id, …)` stores the bytes. `storage_path` on `media_assets` = the media id.

## Ownership
| Agent | Owns | Task |
|---|---|---|
| **M1** | `packages/gateway`, `packages/graph` | Replace serviceClient/Storage with `query`/`queryOne`/`putMedia`; `captureMedia` stores bytes via `putMedia` and sets `storage_path`=id; graph `rateStore` counts via SQL. |
| **M2** | `packages/orchestrator` | All DB access → `query`/`queryOne`. jsonb (brand_voice_profile, strategy_notes) stringified on write. |
| **M3** | `apps/worker` | Publish loop + triggers → SQL. Media URLs for publishing come from `publicMediaUrl(id)`. Keep the approval-gate assertion. |
| **M4** | `apps/web` | Data layer + server actions → SQL. **Replace Supabase Auth** (see below). Add the **public media route**. Remove `@supabase/ssr`, `lib/supabase/*`, `app/auth/*`. |

Schema is `db/migrations/0001_init.sql` + `0002_media_blobs.sql` (canonical column names).

## Web auth (M4) — replace Supabase magic-link with a single-operator password gate
- `.env`: `OPERATOR_PASSWORD` (the password) and `AUTH_SECRET` (signs the cookie).
- `app/login`: a password form → server action; if it equals `OPERATOR_PASSWORD`,
  set an **HttpOnly, Secure, SameSite=Lax** cookie `pulse_session` = HMAC-SHA256(`"operator"`, `AUTH_SECRET`); redirect to `/`.
- `middleware.ts`: allow `/login`, `/privacy`, `/api/webhooks/*`, `/api/media/*`;
  everything else requires a valid `pulse_session` cookie (recompute the HMAC and compare) else redirect to `/login`. Use the Web Crypto API (Edge-safe).
- Delete `lib/supabase/*`, `app/auth/callback`, and any `@supabase/ssr` usage.
- Server data access uses `query`/`queryOne` from `@pulse/shared` (server-only).

## Public media route (M4)
`app/api/media/[id]/route.ts` — `runtime = 'nodejs'`, **public** (no auth). `GET`
loads `getMedia(id)`; returns the bytes with the stored `Content-Type` and a
`Cache-Control: public, max-age=3600`. 404 if missing. This is what Meta fetches.

## Non-negotiables (unchanged)
- Approval is absolute; every publish asserts a logged `approved` action.
- Every external call wrapped in retry/backoff; failures surface.
- Do NOT run `pnpm install`, `git`, or edit root files / other packages. Just your package(s).
- Each package must end with **no** `@supabase/*` dependency and a passing `typecheck` in principle.
