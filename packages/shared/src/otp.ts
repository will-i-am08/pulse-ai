import { randomInt } from "node:crypto";

/**
 * Passwordless-login helpers: phone normalisation + one-time code generation.
 * Pure functions only — DB access lives in the web actions and the gateway
 * delivery poller.
 */

/** A fresh 6-digit numeric login code (crypto-random, zero-padded). */
export function generateLoginCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * Normalise a user-typed phone number to E.164 so it matches the stored
 * `brands.client_phone` / `users.phone`. Defaults unprefixed numbers to the
 * given country (AU by default, since that's the operating region).
 *
 * Returns null if the input can't be made into a plausible E.164 number.
 */
export function normalizePhone(input: string, defaultCountry: "AU" | "NZ" = "AU"): string | null {
  if (!input) return null;
  let s = input.trim();
  const hadPlus = s.startsWith("+");
  const digits = s.replace(/\D/g, "");
  if (!digits) return null;

  // Already international (with +): trust the digits as-is.
  if (hadPlus) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }

  // 00-prefixed international dialling (e.g. 0061...).
  if (digits.startsWith("00")) {
    const rest = digits.slice(2);
    return rest.length >= 8 && rest.length <= 15 ? `+${rest}` : null;
  }

  const cc = defaultCountry === "NZ" ? "64" : "61";
  // Local trunk form: leading 0 then national number (AU/NZ mobiles are 04.../02...).
  if (digits.startsWith("0")) {
    return `+${cc}${digits.slice(1)}`;
  }
  // Bare national number already carrying its country code.
  if (digits.startsWith(cc)) {
    return `+${digits}`;
  }
  // Bare national number without the trunk 0.
  return digits.length >= 8 && digits.length <= 12 ? `+${cc}${digits}` : null;
}

/** Mask a phone for display in logs / UI: +61412345678 -> +61 ••• ••678. */
export function maskPhone(phone: string): string {
  if (phone.length < 4) return "•••";
  const tail = phone.slice(-3);
  const head = phone.startsWith("+") ? phone.slice(0, 3) : "";
  return `${head} ••• ••${tail}`.trim();
}
