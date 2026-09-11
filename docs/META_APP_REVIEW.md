# Meta App Review — submission pack (copy-paste ready)

App: **Pulse AI / Kip** · App ID `2105802910330255` · Business portfolio `4344384375833037`  
Live app: `https://web-tau-three-59.vercel.app`  
Prereq: ✅ **Business Verification complete (2026-09-10)**.

**Icon path (upload this):** [`apps/web/public/brand/kip-logo-1024.png`](../apps/web/public/brand/kip-logo-1024.png)  
Dashboard → App settings → Basic → App icon → 1024×1024 PNG, no transparency, no rounded corners.

Status: App Review submission is the remaining gate before **Live** + `GRAPH_MODE=live` for Wave 1 clients.

---

## Wave 1 scopes (organic publish — submit these first)

Keep **exactly** these for the first App Review. Trim ads/marketing clutter at **App Review → Permissions and Features → Remove**.

| Permission | Why |
|---|---|
| `public_profile` | Facebook Login identity |
| `pages_show_list` | List Pages so the owner picks which to connect |
| `pages_read_engagement` | Read Page + linked IG; later engagement on posts we published |
| `instagram_basic` | Connected IG business id + username |
| `instagram_content_publish` | Publish approved photo/video + caption to owner's IG |
| `pages_manage_posts` | Publish approved posts to owner's Facebook Page |
| `business_management` | Surface Pages held inside Business Manager |

**Add if missing:** `pages_manage_posts` via Use cases → **Manage everything on your Page**.  
`instagram_content_publish` already lives under **Manage messaging & content on Instagram**.

**Remove for Wave 1 (do not request yet):**  
`ads_management`, `ads_read`, `catalog_management`, `leads_retrieval`, `pages_manage_ads`, `ads_mcp_management`, Marketing API tier.

---

## Wave 2 scopes (Meta paid ads — separate / later submission)

Only after Wave 1 Live and a paying ads cohort. Request Advanced Access with a **new screencast** showing confirm-before-spend:

| Permission | Why |
|---|---|
| `ads_management` | Create/pause/boost campaigns the owner confirmed in SMS |
| `ads_read` | Read campaign insights for performance digests + spend caps |
| `business_management` | (already Wave 1) ad account / BM linkage |
| `pages_manage_ads` | Only if required by the Marketing use-case template for Page boosts |

Paste usage copy that stresses: **owner confirms every spend in SMS**; weekly + campaign caps; Kip never spends without `"yes"`.

---

## Permission usage descriptions (paste into each field)

**instagram_content_publish**
> Pulse is a social-media assistant that businesses use to run their own Instagram. The user connects their own Instagram business account via Facebook Login. They send our agent a photo; the agent drafts an on-brand caption; the user approves it in-thread. On approval, Pulse publishes that photo and caption to the user's own Instagram business account using the Content Publishing API. We only ever post content the account owner has approved.

**pages_manage_posts**
> The user connects their own Facebook Page. After the user approves a drafted post (photo + caption), Pulse publishes it to that same Page's feed on the owner's behalf. We only publish content the Page owner has explicitly approved, and only to Pages they manage.

**pages_show_list**
> During onboarding we call `/me/accounts` so the user can choose which of their Facebook Pages to connect to Pulse. Without it we can't show them their Pages to pick from.

**pages_read_engagement**
> We read the connected Page's basic details and its linked Instagram business account (via the Page) so we know where to publish, and later read the engagement (likes/comments/reach) on posts Pulse published to report performance back to the owner.

**instagram_basic**
> We read the connected Instagram business account's id and username (through the linked Page) to confirm the correct account is connected and to target publishing to it.

**business_management**
> Some users' Pages are owned inside a Business Manager. This lets us list those Pages during onboarding so the user can connect a Page held by their business.

**public_profile**
> Basic Facebook Login — we read the person's public profile (name, id) to identify the user connecting their accounts and personalise their dashboard.

---

## Screencast shot list (~2–3 min, Wave 1)

Record on the **live** URL as a **Meta Test User** (or your account). Upload the **same** clip to each permission.

1. **0:00** Log in at `https://web-tau-three-59.vercel.app`.
2. **0:15** Connect with Facebook — pause so scopes are visible (`public_profile`, `pages_show_list`, `pages_read_engagement`, `instagram_basic`, `instagram_content_publish`, `pages_manage_posts`, `business_management`).
3. **0:40** Choose a Page **with linked Instagram** (shows list + IG link).
4. **1:00** Dashboard shows connected Page + IG @handle.
5. **1:15** Send agent a photo → on-brand caption draft in SMS/thread.
6. **1:45** Approve → show **live Instagram** + **Facebook Page** posts.
7. **2:20** End.

---

## Ordered checklist

1. Upload icon from `apps/web/public/brand/kip-logo-1024.png`.
2. Add `pages_manage_posts`; remove unused ads scopes from **this** Wave 1 submission.
3. Record screencast; paste descriptions above.
4. Submit → on approval flip app to **Live** → set `GRAPH_MODE=live`.
5. Wave 2 ads scopes only when ready for paid cohort (see LIVE_CHECKLIST).

**Done already:** Business Verification (2026-09-10); Privacy `/privacy`, Terms `/terms`, Data deletion `/data-deletion`; `instagram_content_publish` active.

---

## Meanwhile (no review needed)

Add early users as **Testers** (App roles) so they can connect in Development mode while review is in flight. See [`LIVE_CHECKLIST.md`](LIVE_CHECKLIST.md) for env + cohort gates.
