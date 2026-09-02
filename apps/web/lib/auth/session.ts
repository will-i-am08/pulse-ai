// Per-user session: the cookie is `<userId>.<HMAC-SHA256(userId, AUTH_SECRET)>`.
// The user id is not secret; the HMAC prevents forgery. Web Crypto only, so this
// module is Edge-safe and importable from middleware.ts (no `pg`, no @pulse/shared).

export const SESSION_COOKIE_NAME = 'pulse_session';

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return toHex(signature);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Build the signed cookie value for a user id. */
export async function createSessionValue(userId: string, authSecret: string): Promise<string> {
  const sig = await hmacHex(authSecret, userId);
  return `${userId}.${sig}`;
}

/** Verify a cookie value; returns the user id if valid, else null. */
export async function verifySessionValue(
  cookieValue: string | undefined,
  authSecret: string,
): Promise<string | null> {
  if (!cookieValue) return null;
  const dot = cookieValue.lastIndexOf('.');
  if (dot <= 0) return null;
  const userId = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  const expected = await hmacHex(authSecret, userId);
  return timingSafeEqual(sig, expected) ? userId : null;
}
