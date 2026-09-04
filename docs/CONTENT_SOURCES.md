# Content sources — auto-pull

Let a brand connect a photo source (Google Photos album / Google Drive folder);
the agent polls it and turns new media into drafted posts automatically — the
back half of "connect a source + auto-pull."

## How it works

1. A `content_sources` row links a brand to a `kind` (`google_photos` /
   `google_drive` / `dropbox`) and an `external_ref` (album or folder id).
2. The bot runs `importFromContentSources()` hourly. For each source it lists
   the newest items, skips anything already imported (dedup on
   `media_assets(brand_id, source_external_id)`), downloads up to
   `MAX_PER_PASS` new items, and stores each as a `source`-origin media asset.
3. Each pulled item is run through the **exact same pipeline a texted-in photo
   uses** — `processInbound` drafts the caption, styles the photo, sorts it into
   a pillar, and schedules it — then the client is pinged: *"📸 Pulled a new one
   from your album — …"* (autopilot pillars post themselves; others wait for a
   "yes").

Token: a source uses its own `encrypted_token` if it has one, otherwise it falls
back to the brand's existing Google refresh token.

## Connecting a source

**Client-facing (self-serve).** The dashboard has a **Photo source** card:
`Connect a photo source` → `/api/connect/source/start` runs a Google OAuth flow
for read-only Photos + Drive access, then `/app/connect/source/choose` lists the
owner's albums and folders to pick from. The chosen source is saved as a
`content_sources` row with its own encrypted refresh token. Flow files:

- `apps/web/lib/google/sources.ts` — scopes, OAuth URLs, Drive/Photos listers
- `apps/web/app/api/connect/source/{start,callback}/route.ts`
- `apps/web/app/app/connect/source/choose/page.tsx` + `apps/web/lib/actions/source.ts`

**Operator (Discord), for the sandbox:**

- `!source add <drive|photos> <folderOrAlbumId>` — link a source
- `!source list` — show linked sources + last sync
- `!source sync` — pull now instead of waiting for the hourly sweep

## To activate live — Google setup

The ingestion engine and the connect flow are built and tested; the OAuth flow
just needs Google access that isn't switched on yet:

1. **Enable the APIs.** In the Pulse Google Cloud project, enable the **Google
   Drive API** and the **Photos Library API**.
2. **Add the scopes.** Add `drive.readonly` and `photoslibrary.readonly` to the
   OAuth consent screen's Data access. (Today the consent screen only carries
   `business.manage`, so these calls would 403.)
3. **Register the redirect URI.** Add
   `https://<app-domain>/api/connect/source/callback` to the OAuth client's
   authorised redirect URIs (alongside the existing Business Profile one), or
   the flow returns `redirect_uri_mismatch`.

The provider endpoints in `packages/gateway/src/content-sources.ts` and
`apps/web/lib/google/sources.ts` use the documented request/response shapes —
verify field names against live access once the scopes above are granted.
