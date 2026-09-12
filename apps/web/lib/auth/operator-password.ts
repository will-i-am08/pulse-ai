import 'server-only';

/** Timing-safe compare of the submitted password to OPERATOR_PASSWORD. */
export function verifyOperatorPassword(password: string): boolean {
  const expected = process.env.OPERATOR_PASSWORD;
  if (!expected || !password) return false;
  if (expected.length !== password.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ password.charCodeAt(i);
  }
  return diff === 0;
}
