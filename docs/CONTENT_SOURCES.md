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

## Operating it (sandbox)

From the brand's Discord channel:

- `!source add <drive|photos> <folderOrAlbumId>` — link a source
- `!source list` — show linked sources + last sync
- `!source sync` — pull now instead of waiting for the hourly sweep

## To activate live — two steps

The ingestion engine is built and tested; fetching real media needs Google
access that isn't set up yet:

1. **Enable the API + scope.** In the Pulse Google Cloud project, enable the
   **Google Drive API** and/or **Photos Library API**, add the read scope
   (`https://www.googleapis.com/auth/drive.readonly` /
   `.../auth/photoslibrary.readonly`) to the OAuth consent screen, and have the
   brand re-consent so the stored token carries it. (Today the token only has
   `business.manage`, so Drive/Photos calls will 403.)
2. **A first-class connect flow.** The `!source` command is the operator path;
   a client-facing "connect your album" flow (like the GBP connect) can create
   the `content_sources` row with its own scoped token.

The provider endpoints in `packages/gateway/src/content-sources.ts` use the
documented request/response shapes — verify field names against live access
once the scopes above are granted.
