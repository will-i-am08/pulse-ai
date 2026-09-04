import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

// Signed OAuth `state`: binds the callback to the user who started the flow and
// guards against CSRF. Format: base64url(userId.issuedAtMs).hmac
const MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes to complete the dialog

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET is not set');
  return s;
}

// Domain-separate this HMAC from the session-cookie HMAC (which shares
// AUTH_SECRET) so a signature from one scheme can never be valid in the other.
const DOMAIN = 'fb-oauth-state.v1:';

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(DOMAIN + payload).digest('base64url');
}

export function signState(userId: string): string {
  const payload = `${userId}.${Date.now()}`;
  const b64 = Buffer.from(payload).toString('base64url');
  return `${b64}.${sign(b64)}`;
}

/** Returns the userId if the state is valid and fresh, else null. */
export function verifyState(state: string | null): string | null {
  if (!state) return null;
  const dot = state.lastIndexOf('.');
  if (dot < 0) return null;
  const b64 = state.slice(0, dot);
  const mac = state.slice(dot + 1);
  const expected = sign(b64);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const payload = Buffer.from(b64, 'base64url').toString('utf8');
  const [userId, issued] = payload.split('.');
  if (!userId || !issued) return null;
  if (Date.now() - Number(issued) > MAX_AGE_MS) return null;
  return userId;
}
