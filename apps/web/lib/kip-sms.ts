import 'server-only';
import {
  formatE164ForDisplay,
  getServerEnv,
  smsComposeHref,
  smsLeadPrefillBody,
} from '@pulse/shared';

export function kipSmsNumber(): string | null {
  try {
    return getServerEnv().TWILIO_FROM_NUMBER ?? null;
  } catch {
    return null;
  }
}

export function kipSmsComposeHref(source?: string | null): string | null {
  const number = kipSmsNumber();
  if (!number) return null;
  return smsComposeHref(number, smsLeadPrefillBody(source));
}

export function kipSmsNumberDisplay(): string | null {
  const number = kipSmsNumber();
  return number ? formatE164ForDisplay(number) : null;
}
