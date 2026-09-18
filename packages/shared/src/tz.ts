/** Default owner-facing timezone when env is missing or platform junk. */
export const DEFAULT_APP_TZ = "Australia/Sydney";

/**
 * True when `tz` is a valid IANA id for Intl (rejects Vercel/Node junk like `:UTC`).
 */
export function isValidIanaTimeZone(tz: string): boolean {
  if (!tz || typeof tz !== "string") return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/**
 * Strip / alias raw TZ env values into a candidate IANA id.
 * Returns null when empty after normalization.
 */
export function normalizeTimeZoneCandidate(raw: string | undefined | null): string | null {
  if (raw == null) return null;
  let t = String(raw).trim();
  if (!t) return null;
  // Linux / some hosts set TZ=:UTC — the leading colon is not valid for Intl.
  if (t.startsWith(":")) t = t.slice(1).trim();
  if (!t) return null;
  if (t === "Etc/UTC" || t === "Etc/GMT" || t === "GMT" || t === "UCT" || t === "Z") {
    return "UTC";
  }
  return t;
}

/**
 * First valid IANA timezone among candidates, else {@link DEFAULT_APP_TZ}.
 */
export function resolveAppTz(...candidates: Array<string | undefined | null>): string {
  for (const c of candidates) {
    const n = normalizeTimeZoneCandidate(c);
    if (n && isValidIanaTimeZone(n)) return n;
  }
  return DEFAULT_APP_TZ;
}

/**
 * True when the raw env looks like a host/platform default (e.g. Vercel `TZ=:UTC`)
 * rather than an explicit operator-chosen IANA zone.
 */
export function isPlatformDefaultTz(raw: string | undefined | null): boolean {
  if (raw == null) return true;
  const t = String(raw).trim();
  if (!t) return true;
  // Leading-colon forms are never intentional app config.
  if (t.startsWith(":")) return true;
  return false;
}

/**
 * Process-wide app timezone for Intl `timeZone` options.
 * Never returns an Intl-invalid id. Platform junk (`:UTC`) → {@link DEFAULT_APP_TZ}.
 */
export function appTz(): string {
  const pulse = process.env.PULSE_APP_TZ;
  if (pulse && !isPlatformDefaultTz(pulse)) {
    return resolveAppTz(pulse);
  }
  const raw = process.env.TZ;
  if (isPlatformDefaultTz(raw)) return DEFAULT_APP_TZ;
  return resolveAppTz(raw);
}
