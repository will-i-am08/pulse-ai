# Live go-live checklist

Gates that code can enforce vs human/app-store approvals that must happen outside the repo.

## Mock fallback (`platformConfigured`)

Every optional destination uses the same live-adapter shape:

```ts
if (!platformConfigured("linkedin" | "tiktok" | "x" | "threads") || !brand.<tokens>) {
  return new MockGraphAdapter().publish(input);
}
```

- **Never** gate that decision with `getServerEnv()` — it throws when unrelated env is missing.
- Aliases: `linkedin` → `LINKEDIN_CLIENT_ID`, `tiktok` → `TIKTOK_CLIENT_KEY`, `x` → `X_CLIENT_ID`, `threads` → `THREADS_APP_ID`.
- Brand tokens / org ids are still checked at the call site.

### X / Threads

- Confirmed: when `X_CLIENT_ID` / `THREADS_APP_ID` is unset **or** the brand has not connected, LiveGraphAdapter uses the mock feed.
- X remains `isMockOnlyPlatform` for owner-facing “did not go live” confirmation copy until a paid X tier is productized.
- Threads counts as live once GRAPH_MODE=live and a real Threads publish succeeds.

## LinkedIn

- Live when `LINKEDIN_CLIENT_ID` + `linkedin_tokens_encrypted` + `linkedin_org_id`.
- Posts API shapes: text / image / multi-image / video; HTTP media is uploaded via Images/Videos API first.
- Clear SMS errors for missing Company Page **admin** and **partner / Marketing Developer Platform** approval.

## TikTok

- Live when `TIKTOK_CLIENT_KEY` + brand tokens.
- **`TIKTOK_AUDIT_PASSED`** (`true` / `1` / `yes`): required for **public** Direct Post.
- Without audit: privacy forced to **`SELF_ONLY`** (private only).
- AIGC (`is_aigc`) when `style_meta.aigc` / `ai_video_job_id` / caption marks AI video.
- Caption / rate / consent errors map to readable SMS.

## Meta organic + Ads

- IG/FB organic: App Review + professional IG linked to a Page the owner admins.
- Ads live (`marketingLive`): create campaign, boost, insights spend when `ads_tokens_encrypted` + `ad_account_id` present.
- SMS choose-ads flow persists `ad_account_id` + encrypted ads token bag (`selectAdAccountFromSmsAction`).

## AI video

- Requires `AI_VIDEO_PRIMARY_MODEL` and/or `AI_VIDEO_SECONDARY_MODEL` (+ `REPLICATE_API_TOKEN` or `FAL_KEY`).
- Unset models → SMS refuse (no queue).
- Worker drain loop logs `cost_cents` (`AI_VIDEO_COST_*`).

## Still requiring external human approval (cannot be coded)

| Gate | Why code cannot finish it |
| --- | --- |
| Meta App Review (IG/FB publish, insights, messaging) | Meta human review of use cases / screencast |
| Meta Marketing API / ads access | Business verification + ads product access |
| LinkedIn Marketing Developer Platform / partner | LinkedIn app product approval |
| LinkedIn Company Page admin on the connecting user | Real org ACL on the customer's Page |
| TikTok Content Posting API audit | TikTok audit of Direct Post for public privacy |
| X paid API tier (if required for production write) | X developer console / billing |
| Threads “Threads API” use case on Meta app | Meta app review for Threads |
| Production OAuth redirect allowlists | Console config on each provider |
