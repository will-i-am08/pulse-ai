// Single-operator session: the cookie value is HMAC-SHA256("operator", AUTH_SECRET).
// No user table, no tokens to store — just "does this cookie match the secret".
//
// Uses only the Web Crypto API (`crypto.subtle`, available as a global in both
// the Node.js and Edge runtimes) so this module is safe to import from
// `middleware.ts`, which runs on the Edge runtime and cannot bundle `pg`
// (hence: no import from `@pulse/shared` here).

export const SESSION_COOKIE_NAME = 'pulse_session';

const SESSION_SUBJECT = 'operator';

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacHex(secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(SESSION_SUBJECT));
  return toHex(signature);
}

/** The cookie value to set on successful login. */
export async function sessionCookieValue(authSecret: string): Promise<string> {
  return hmacHex(authSecret);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Recomputes the expected HMAC and compares it against the cookie value. */
export async function isValidSessionCookie(
  cookieValue: string | undefined,
  authSecret: string
): Promise<boolean> {
  if (!cookieValue) return false;
  const expected = await hmacHex(authSecret);
  return timingSafeEqual(cookieValue, expected);
}
