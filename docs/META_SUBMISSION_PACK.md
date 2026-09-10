# Meta App Review — submission pack (ready to execute)

App: **Pulse AI** · App ID `2105802910330255` · Business portfolio `4344384375833037`
Live app: `https://web-tau-three-59.vercel.app`
Prereq: ✅ Business Verification complete (2026‑09‑10). This pack is the four pieces between "verified" and "Live".

Do them in order. Total time ≈ 30–40 min once the icon PNG is in hand.

---

## Piece 1 — App icon (the last eligibility blocker)

**Spec**
- **1024 × 1024 px**, PNG, **square**, no rounded corners (Meta rounds it), no transparency (fill the background).
- Under 5 MB. Logo centred with a little padding; must be legible at 32 px.

**Where**
- Dashboard → **App settings → Basic → App icon** → upload → **Save changes** (bottom right).

**Done when:** the icon shows in the top-left app switcher and Basic settings no longer flags it.

---

## Piece 2 — Fix the permission set (add one, remove the clutter)

The app was seeded from an ads template. Trim it to the **7 permissions we actually use**, and add the one missing publisher scope.

**Keep exactly these 7:**
| Permission | Why |
|---|---|
| `public_profile` | Basic Facebook Login |
| `pages_show_list` | List the user's Pages so they can pick one |
| `pages_read_engagement` | Read the connected Page + its linked IG account, and post engagement for reporting |
| `instagram_basic` | Read the connected IG business account (id, username) |
| `instagram_content_publish` | Publish approved photo + caption to the user's IG |
| `pages_manage_posts` | Publish approved posts to the user's Facebook Page |
| `business_management` | Surface Pages held inside a Business Manager |

**Add:** `pages_manage_posts`
- Dashboard → **Use cases → Add use cases → "Manage everything on your Page"** (this brings in `pages_manage_posts`). It was gated behind verification before — should add cleanly now.
- (`instagram_content_publish` already lives under the customised "Manage messaging & content on Instagram" use case.)

**Remove these (unused ads/marketing scopes):** at **App Review → Permissions and Features**, click **Remove** beside each —
`ads_management`, `ads_read`, `catalog_management`, `leads_retrieval`, `pages_manage_ads`, `ads_mcp_management`, and drop the **Marketing API** access tier.
> Meta's "Add use cases" dialog is add-only — you can only trim at the App Review step, so do it here.

**Done when:** App Review lists only the 7 permissions above, each set to request **Advanced Access**.

---

## Piece 3 — Screencast (record one clean run, ~2–3 min)

Reviewers must *see* each permission used in a real flow. Record on the **live** app (`web-tau-three-59.vercel.app`) logged in as a **Meta Test User** or your own account. Screen-record at 1080p, cursor visible, no dead air. Upload the **same** clip against each permission.

**Shot list (narrate briefly on screen or in the caption):**
1. **0:00 — Log in.** Open the live app, sign in. Land on the dashboard.
2. **0:15 — Start connect.** Click **Connect with Facebook**. On the Facebook dialog, pause so the granted scopes are visible: `public_profile, pages_show_list, pages_read_engagement, instagram_basic, instagram_content_publish, pages_manage_posts, business_management`. Click **Continue / Allow**.
3. **0:40 — Choose a Page.** On the "Choose a page" screen, show the list of Pages *(demonstrates `pages_show_list`, `business_management`)* and pick one **with a linked Instagram** *(demonstrates `pages_read_engagement`, `instagram_basic`)*.
4. **1:00 — Confirm connected.** Show the dashboard now reads connected (Page name + IG @handle).
5. **1:15 — Draft.** Send the agent a photo → it returns an on-brand caption. Show the draft in-thread.
6. **1:45 — Approve & publish.** Approve the draft → show it **published to the real Instagram** and **to the Facebook Page** *(demonstrates `instagram_content_publish` + `pages_manage_posts`)*. Open both posts to prove they're live.
7. **2:20 — End.**

**Tips:** use a real photo; make sure the Test User has a Page with a linked IG business account; if the reviewer can't reproduce it, they reject — so show the published posts on-platform, not just a success toast.

---

## Piece 4 — Submit (permission usage descriptions to paste)

Paste one into each permission's **"How will your app use this permission?"** field, then attach the screencast and submit.

**instagram_content_publish**
> Pulse is a social‑media assistant businesses use to run their own Instagram. The user connects their own Instagram business account via Facebook Login. They send our agent a photo; the agent drafts an on‑brand caption; the user approves it in‑thread. On approval, Pulse publishes that photo and caption to the user's own Instagram business account using the Content Publishing API. We only ever post content the account owner has approved.

**pages_manage_posts**
> The user connects their own Facebook Page. After the user approves a drafted post (photo + caption), Pulse publishes it to that same Page's feed on the owner's behalf. We only publish content the Page owner has explicitly approved, and only to Pages they manage.

**pages_show_list**
> During onboarding we call `/me/accounts` so the user can choose which of their Facebook Pages to connect to Pulse. Without it we cannot show them their Pages to pick from.

**pages_read_engagement**
> We read the connected Page's basic details and its linked Instagram business account (via the Page) so we know where to publish, and later read the engagement (likes/comments/reach) on posts Pulse published to report performance back to the owner.

**instagram_basic**
> We read the connected Instagram business account's id and username (through the linked Page) to confirm the correct account is connected and to target publishing to it.

**business_management**
> Some users' Pages are owned inside a Business Manager. This lets us list those Pages during onboarding so the user can connect a Page held by their business.

**public_profile** — usually auto‑granted; if asked: *Basic Facebook Login to identify the user connecting their accounts.*

**Final submit checklist**
- [ ] App icon uploaded (Piece 1)
- [ ] Exactly the 7 permissions listed; ads scopes removed (Piece 2)
- [ ] Each permission requests **Advanced Access**
- [ ] Screencast uploaded against every permission (Piece 3)
- [ ] Usage descriptions pasted (above)
- [ ] Data-deletion / Privacy / Terms URLs still set (they are)
- [ ] **Submit for review** → then, on approval, **flip the app to Live** (App Mode toggle, top bar)

---

## While review is pending — earn now
Add your beta cohort as **Meta Testers** (Dashboard → **App roles → Roles / Test users**). Testers get full access in Development mode with **no App Review**, so the whole flow — including the new voice agent — runs for real clients today. Cash and proof while Meta processes the queue (typical review turnaround is a few business days once submitted).
