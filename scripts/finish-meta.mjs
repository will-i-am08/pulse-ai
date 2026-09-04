// One-off: derive a durable (non-expiring) Facebook Page access token from a
// short-lived user token, then store it (encrypted) + the Page/IG ids against a
// brand so GRAPH_MODE=live can publish. Reads USER_TOKEN from the environment so
// the raw token never lands in argv. Never prints any token value.
import { getServerEnv, query } from "../packages/shared/src/index.ts";
import { encryptJson } from "../packages/shared/src/crypto.ts";

const GV = "v21.0";
const g = async (path, params) => {
  const url = new URL(`https://graph.facebook.com/${GV}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(`${path}: ${JSON.stringify(body.error ?? body).slice(0, 300)}`);
  return body;
};

const USER_TOKEN = process.env.USER_TOKEN;
const BRAND_ID = process.env.BRAND_ID;
const PAGE_ID = process.env.PAGE_ID;
const IG_USER_ID = process.env.IG_USER_ID;
if (!USER_TOKEN || !BRAND_ID || !PAGE_ID || !IG_USER_ID) {
  throw new Error("Set USER_TOKEN, BRAND_ID, PAGE_ID, IG_USER_ID");
}

const env = getServerEnv();
const APP_ID = env.META_APP_ID;
const APP_SECRET = env.META_APP_SECRET;
if (!APP_ID || !APP_SECRET) throw new Error("META_APP_ID / META_APP_SECRET missing from env");

// 1) short-lived user token -> long-lived (~60d) user token
const longUser = await g("oauth/access_token", {
  grant_type: "fb_exchange_token",
  client_id: APP_ID,
  client_secret: APP_SECRET,
  fb_exchange_token: USER_TOKEN,
});

// 2) long-lived user token -> Page token (non-expiring for a Page you manage)
const page = await g(`${PAGE_ID}`, {
  fields: "name,access_token,instagram_business_account{id,username}",
  access_token: longUser.access_token,
});
const pageToken = page.access_token;
if (!pageToken) throw new Error("No page access_token returned — is the user an admin of this Page?");

// 3) sanity: the Page token can read the Page, and the IG account matches
const check = await g(`${PAGE_ID}`, { fields: "name", access_token: pageToken });
const igLinked = page.instagram_business_account?.id;

// 4) confirm the page token never expires (debug_token)
const dbg = await g("debug_token", {
  input_token: pageToken,
  access_token: `${APP_ID}|${APP_SECRET}`,
});
const expiresAt = dbg.data?.expires_at; // 0 = never

// 5) store: same page token is used for both IG publish and FB page publish
const encrypted = encryptJson({ ig_access_token: pageToken, fb_page_access_token: pageToken });
await query(
  `update brands set ig_user_id = $1, fb_page_id = $2, platform_tokens_encrypted = $3 where id = $4`,
  [IG_USER_ID, PAGE_ID, encrypted, BRAND_ID],
);

console.log(JSON.stringify({
  ok: true,
  page: check.name,
  fb_page_id: PAGE_ID,
  ig_user_id: IG_USER_ID,
  ig_linked_on_page: igLinked ?? null,
  ig_username: page.instagram_business_account?.username ?? null,
  page_token_len: pageToken.length,
  page_token_expires_at: expiresAt === 0 ? "never" : expiresAt,
  long_user_token_expires_in_days: longUser.expires_in ? Math.round(longUser.expires_in / 86400) : null,
  scopes_note: "stored encrypted on brand " + BRAND_ID,
}, null, 2));
process.exit(0);
