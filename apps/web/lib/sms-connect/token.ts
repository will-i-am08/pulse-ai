import 'server-only';
import {
  mintSmsConnectToken,
  verifySmsConnectToken,
  type SmsConnectPurpose,
} from '@pulse/shared';

export { mintSmsConnectToken, verifySmsConnectToken };
export type { SmsConnectPurpose };

/** Sign OAuth state for an SMS-initiated Meta connect (no dashboard session). */
export function signSmsOauthState(brandId: string, purpose: SmsConnectPurpose = 'meta'): string {
  // Reuse the connect token as OAuth state — same TTL + brand binding.
  return mintSmsConnectToken(brandId, purpose);
}

export function verifySmsOauthState(state: string | null):
  | { ok: true; brandId: string; purpose: SmsConnectPurpose }
  | { ok: false; reason: 'invalid' | 'expired' } {
  return verifySmsConnectToken(state);
}
