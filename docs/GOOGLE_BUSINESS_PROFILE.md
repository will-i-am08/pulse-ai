# Google Business Profile — setup & access

Phase B connects **Google Business Profile (GBP)** so the agent can **post to your Google listing** and **handle Google reviews** (reviews flow into the same engagement engine as IG/FB comments).

Like Meta, the live connection is **approval-gated** — this time by Google, on a **separate Google Cloud project** tied to your Google account. Google's API-access review is the long pole, so **start it early** (in parallel with Meta verification).

---

## What's ready in code

- **Google is a first-class platform** (`posts.platform` accepts `google`; scheduler has Google windows).
- **Reviews route through the engagement engine** already — a Google review is triaged exactly like a comment (auto-reply / draft / escalate). Test it now with `!sim review <text>` in the bot.
- The live publisher/review-reply is a **thin adapter** we switch on once the GBP connection + token exist. Until then, a `google` post fails with a clear "not connected yet" message.

So Phase B is **code-ready**; what remains is the Google-side access + OAuth, which only you can do.

---

## What you need to do (Google side)

1. **Create a Google Cloud project** at [console.cloud.google.com](https://console.cloud.google.com) (or reuse one for Pulse).
2. **Enable the Business Profile APIs** on that project:
   - *My Business Account Management API*
   - *My Business Business Information API*
   - *Business Profile Performance API* (for metrics, later)
   - (Review reply + local posts are served via the Business Profile APIs.)
3. **Request GBP API access** — Google gates these APIs behind an access request form (you describe the app + use case). **This is the long pole; submit it first.** Approval can take days–weeks.
4. **Configure the OAuth consent screen** (external), add the Business Profile scopes, and add `will@jmcalder.com` as a test user while in testing.
5. **Create OAuth 2.0 credentials** (Web application): add the redirect URI `https://web-tau-three-59.vercel.app/api/connect/google/callback`.
6. Make sure the **Google Business Profile listing is verified** (the physical business is verified with Google) — GBP posting/review APIs require a verified location.

Hand me the **OAuth client ID + secret** (I'll store them encrypted, like the Meta ones) once the project's set up, and I'll wire the connect flow.

---

## The connect flow is BUILT — it just needs your credentials

Already shipped (deployed, waiting on `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`):
- `GET /api/connect/google/start` + `/callback` — OAuth to link the owner's Google account (offline access → refresh token, stored encrypted), a **location picker** (`/app/connect/google/choose`), and a **"Connect Google"** button on the dashboard. Mirrors the Facebook linking flow exactly.

**To switch it on, hand me two things** from your Google Cloud OAuth client (Web application):
1. **`GOOGLE_CLIENT_ID`**
2. **`GOOGLE_CLIENT_SECRET`**

…with this exact **Authorised redirect URI** set on that client:

```
https://web-tau-three-59.vercel.app/api/connect/google/callback
```

I'll store them encrypted in the env and the "Connect Google" button goes live.

## Still to build (after connect works)
- GBP **publisher** — posts scheduled `google` content as a local post.
- GBP **review sync** — poll the location's reviews into `interactions`; the engagement engine drafts/handles replies; approved replies post back via the API.

---

## Ordered checklist

**You:**
1. Create/choose a Google Cloud project.
2. Enable the Business Profile APIs.
3. **Submit the GBP API access request** (do this first — long pole).
4. Set up OAuth consent + credentials with the redirect URI above.
5. Confirm your Google Business Profile location is verified.
6. Send me the OAuth client ID + secret.

**Me (once you have access + credentials):**
- Build the Google connect flow, GBP publisher, and review sync; flip Google live.

---

## Phase C — Google Photos / Drive as a content source

The same Google Cloud project also powers the **content source** (Phase C): the owner drops photos in a **Google Photos album** or **Drive folder** and the agent pulls them into the queue.

- Enable the **Google Photos Library API** and/or **Google Drive API** on the same project.
- Add the read-only scopes (`photoslibrary.readonly` / `drive.readonly`) to the OAuth consent screen.
- Connect flow: `GET /api/connect/google/start` (reuse the Google OAuth) → the owner picks an album/folder → stored in `content_sources` (table already created) → a sync loop imports new media, auto-classifies it into a pillar, and schedules it.

This is groundwork + gated on the same OAuth. The **generation-to-fill** half of Phase C (AI photo-style images + quote cards) and **URL repurposing** ("turn my website into posts") are already built and testable now — no Google needed.

## Meanwhile

Google **reviews** already triage through the engagement engine — try `!sim review great spot, will be back!` and `!sim review waited an hour, terrible` in the bot to see a positive review auto-handled and a negative one escalated to you. That's the Phase-B experience, minus the live pipe.
