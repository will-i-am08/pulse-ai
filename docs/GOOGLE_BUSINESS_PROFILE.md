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

## What I'll build once access is granted

- `GET /api/connect/google/start` + `/callback` — OAuth to link the owner's Google account + pick the GBP location (mirrors the Facebook linking flow).
- GBP **publisher** — posts scheduled `google` content as a local post.
- GBP **review sync** — poll the location's reviews into `interactions`; the engagement engine drafts/handles replies; approved replies post back via the API.
- Store the Google token encrypted alongside the Meta tokens.

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

## Meanwhile

Google **reviews** already triage through the engagement engine — try `!sim review great spot, will be back!` and `!sim review waited an hour, terrible` in the bot to see a positive review auto-handled and a negative one escalated to you. That's the Phase-B experience, minus the live pipe.
