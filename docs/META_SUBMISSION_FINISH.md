# Meta App Review — the finish line (state as of 2026-09-10)

I did the structural work in your dashboard. What's left genuinely needs your hands
(a screen recording, the icon file, live test calls, and your certification). This is
the exact, ordered finish — with every description ready to paste.

## ✅ Done (by me, verified in the dashboard)
- Removed all 7 ads/marketing scopes from the App Review request
  (`ads_management`, `ads_read`, `pages_manage_ads`, `ads_mcp_management`,
  `catalog_management`, `leads_retrieval`, `Marketing API Access Tier`).
- Added **`pages_manage_posts`** to the request (via the "Manage everything on your Page" use case).
- The request now contains exactly these 9, plus `instagram_content_publish` (already granted, so it isn't listed):
  `pages_manage_posts`, `threads_basic`, `instagram_business_basic`,
  `instagram_manage_comments`, `pages_show_list`, `business_management`,
  `pages_read_engagement`, `public_profile`, `instagram_basic`.
- Saved the **`pages_manage_posts`** usage description + ticked its agreement.

## ⛳ What's left (yours — in order)

**Submission page (keep this open):**
`https://developers.facebook.com/apps/2105802910330255/app-review/submissions/?business_id=4344384375833037`

### 1. App icon — `App settings → Basic`
`https://developers.facebook.com/apps/2105802910330255/settings/basic/`
Upload the 1024×1024 PNG (square, no transparency) → **Save changes**.

### 2. Do the required API test calls — `Review → Testing`, or the Graph API Explorer
`https://developers.facebook.com/tools/explorer/2105802910330255/`
Each permission needs ≥1 real API call recorded (the modals show "0 of 1 API call(s) required").
Easiest: run the live app end-to-end **as a Meta Test User** (connect → draft → approve →
publish to IG + FB), which exercises them naturally. Test-call data can take up to 24h to show.

### 3. Record ONE screencast (~2–3 min) — then upload it to each permission
Record on the live app (`https://web-tau-three-59.vercel.app`), logged in as a Test User,
cursor visible, no dead air. It must show the OAuth consent screen and the real publish.
Shot list: log in → **Connect with Facebook** (pause on the permissions dialog) → choose a
Page with a linked IG → dashboard shows connected → send a photo → approve the draft →
show it **published to the real Instagram and Facebook Page**. (This one clip covers every
permission; upload the same file against each.)

### 4. Allowed usage — paste a description, attach the screencast, tick "agree", Save (per permission)
On the submission page → **Allowed usage → Go to allowed usage → Get started** on each.
`pages_manage_posts` is already done. Paste these into the rest:

**threads_basic**
> The user connects their own Threads profile via OAuth. Pulse uses threads_basic to read the connected profile's identity and its posts so we can (a) learn the account's writing style during onboarding, so future posts sound like the owner, and (b) confirm the correct account is connected. We only access the profile the user explicitly connected, and only act on content they approve.

**instagram_business_basic**
> We read the connected Instagram business account's basic profile (id, username) and its media so we can confirm the correct account is connected and learn the account's content style during onboarding. Access is limited to the IG business account the user connected via Facebook Login.

**instagram_manage_comments**
> When someone comments on the connected Instagram account's own posts, Pulse helps the owner respond: it reads incoming comments and, on the owner's approval or per rules they set, publishes replies and hides obvious spam on their behalf. We only ever manage comments on the connected account's own media.

**pages_show_list**
> During onboarding we call /me/accounts so the user can choose which of their own Facebook Pages to connect to Pulse. Without it we can't show them their Pages to pick from.

**business_management**
> Some users' Pages are owned inside a Business Manager. This lets us list those Pages during onboarding so the user can connect a Page held by their business.

**pages_read_engagement**
> We read the connected Page's basic details and its linked Instagram business account (via the Page) so we know where to publish, and later read the engagement (likes, comments, reach) on posts Pulse published, to report performance back to the owner.

**public_profile**
> Basic Facebook Login — we read the person's public profile (name, id) to identify the user connecting their accounts and personalise their dashboard. (This one may only ask you to tick "agree".)

**instagram_basic**
> We read the connected Instagram business account's id and username (through the linked Page) to confirm the correct account is connected and to target publishing to it.

**instagram_content_publish** (if it asks — already granted, so it may not)
> After the user approves a caption we drafted for their photo, Pulse publishes that approved photo + caption to the user's own Instagram business account via the Content Publishing API. We only ever post content the account owner has approved in-thread.

### 5. Data handling & Reviewer instructions
Complete the **Data handling** step (answer truthfully — we store connected-account tokens
encrypted and post only owner-approved content) and **Reviewer instructions** (give a test
login and a one-line "connect a Page with a linked IG, send a photo, approve, watch it publish").

### 6. Submit
When every step shows a green tick, the greyed **Submit for review** button goes live. Click it.
On approval → **flip the app to Live** (top bar) and any client can connect.

## Meanwhile — earn now
Add your beta cohort as **Meta Testers** (`App roles → Roles / Test users`). Testers need no
review, so the full flow — voice agent included — runs for real clients today while Meta's
queue processes (typically a few business days once submitted).
