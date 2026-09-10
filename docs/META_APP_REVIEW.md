# Meta App Review — submission pack

App: **Pulse AI** (App ID `2105802910330255`) · Business portfolio `4344384375833037`
Goal: get **Advanced Access** for the publishing permissions + **Business Verification** so **any** user (not just app testers) can connect their Instagram/Facebook and the agent can publish for real — and so Facebook Page posting works.

Status audited 2026-09-04.

---

## Where it stands

| Item | State |
| --- | --- |
| Facebook Login for Business | ✅ configured (config `1372408348385507`) |
| Privacy Policy URL | ✅ set → `/privacy` |
| Terms of Service URL | ✅ set → `/terms` |
| User-data-deletion URL | ✅ set → `/data-deletion` |
| App domain | ✅ `web-tau-three-59.vercel.app` |
| App icon (1024×1024) | ⬜ **upload the PNG I sent** — the last eligibility blocker |
| **Business & access verification** | ✅ **COMPLETE & verified (2026-09-10)** — the gate is down |
| `pages_manage_posts` (FB posting) | 🟩 **unblocked** — add to App Review now that verification is done |
| App Review submission | ⬜ **next up** — no longer blocked; submit with the descriptions below |

> **Business Verification is done.** That was the long pole and it gated advanced Page access. `pages_manage_posts` should now add to the review cleanly (it errored before only because it's gated behind verification). `instagram_content_publish` (Instagram posting) is already active. The remaining work is the **App Review submission itself** (add `pages_manage_posts`, trim the unused scopes, record the screencast, submit) → then flip the app to **Live**.

The app is currently cluttered with **ads/marketing use cases** (ads_management, ads_read, catalog_management, leads_retrieval, pages_manage_ads, Marketing API tier…) pulled in from a template. **We don't use any of them.** Removing them shrinks the review to only what we need and makes approval faster.

---

## The permissions we actually need

Keep only these; everything else can be removed via **Dashboard → Use cases → customize**:

| Permission | Why we need it |
| --- | --- |
| `public_profile` | Basic Facebook Login. |
| `pages_show_list` | List the Pages a user manages so they can pick which one to connect. |
| `pages_read_engagement` | Read the connected Page + its linked Instagram account. |
| `instagram_basic` | Read the connected Instagram business account (id, username). |
| `instagram_content_publish` | Publish the approved photo + caption to the user's Instagram. |
| `pages_manage_posts` | Publish approved posts to the user's Facebook Page feed. |
| `business_management` | Surface Pages that are held inside a Business Manager. |

> `instagram_content_publish` lives in the **"Manage messaging & content on Instagram"** use case (already customized). `pages_manage_posts` needs the **"Manage everything on your Page"** use case added (Dashboard → Add use cases).

---

## Permission usage descriptions (paste into each "How will your app use this?" field)

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

---

## Screencast (record one clean run, ~2–3 min)

Reviewers must see each permission used in a real flow. Record on the **live** app while logged in as a **test user** (or your own account):

1. Sign up / log in at `https://web-tau-three-59.vercel.app`.
2. Click **Connect with Facebook** → Facebook dialog → grant the permissions (shows `public_profile`, `pages_show_list`, `pages_read_engagement`, `instagram_basic`, `instagram_content_publish`, `pages_manage_posts`, `business_management`).
3. On the **Choose a page** screen, pick a Page with a linked Instagram (shows `pages_show_list` / `pages_read_engagement` / `instagram_basic`).
4. Show the dashboard now says connected.
5. Trigger a post: send the agent a photo → it drafts a caption → approve → show it **published to the real Instagram** (and Facebook Page) — this demonstrates `instagram_content_publish` and `pages_manage_posts`.

Upload the same screencast against each permission in the submission.

---

## Ordered checklist

**Next (the critical path now that verification is done):**
1. **Upload the app icon** (Dashboard → App settings → Basic → App icon) — the last eligibility blocker for submission. Use the PNG I sent, or your logo.
2. **Add `pages_manage_posts` to App Review** (it errored before only because it was gated behind verification — should add cleanly now).
3. **Slim the review to the 7 permissions we use**: on **Review → App Review**, use the **"remove"** link beside each ads/marketing permission (`ads_management`, `ads_read`, `catalog_management`, `leads_retrieval`, `pages_manage_ads`, `ads_mcp_management`, Marketing API tier). (Meta's "Add use cases" dialog is add-only, so trim at the submission step.)
4. **Record the screencast** (see above) on the live app as a test user.
5. **Submit for App Review** with the permission descriptions above.
6. **After approval → flip the app to Live** → any user can connect without a tester invite, and Facebook Page posting works. Then the gated Phase-3 pieces (per-platform tailoring, engagement learning) come online, and `GRAPH_MODE=live` with real tokens goes hot.

**Done:**
- ✅ **Business & access verification — complete and verified (2026-09-10).** The long pole is cleared.
- Privacy Policy, Terms of Service, and data-deletion URLs set to live pages; app domain added.
- Built `/terms` and `/data-deletion` pages on the site.
- `instagram_content_publish` active.

---

## Meanwhile (no review needed)

Early-access users can onboard **today** by adding them as **Testers** (Dashboard → App roles → Roles/Test users → add their Facebook account). Testers get full access in Development mode with no App Review. Use this to run your first beta cohort while verification + review are in flight.
