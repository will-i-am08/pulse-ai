import { createHmac, timingSafeEqual } from "node:crypto";
import { getServerEnv } from "./env.js";

/** What an SMS deep-link connect token unlocks. */
export type SmsConnectPurpose = "meta" | "ads" | "linkedin" | "tiktok" | "crm";

export type SmsConnectPayload = {
  brandId: string;
  purpose: SmsConnectPurpose;
  issuedAt: number;
};

/** Default link lifetime — short so a forwarded SMS goes stale quickly. */
export const SMS_CONNECT_TTL_MS = 15 * 60 * 1000;

const DOMAIN = "sms-connect.v1:";

const PURPOSES: readonly SmsConnectPurpose[] = ["meta", "ads", "linkedin", "tiktok", "crm"];

function isPurpose(p: string): p is SmsConnectPurpose {
  return (PURPOSES as readonly string[]).includes(p);
}

function secret(): string {
  // Prefer AUTH_SECRET (same family as OAuth state); fall back to TOKEN_ENCRYPTION_KEY
  // so minting works in the worker where AUTH_SECRET may be unset.
  const env = getServerEnv();
  const s = env.AUTH_SECRET || env.TOKEN_ENCRYPTION_KEY;
  if (!s) throw new Error("AUTH_SECRET or TOKEN_ENCRYPTION_KEY is required for SMS connect tokens");
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(DOMAIN + payload).digest("base64url");
}

/** Mint a short-lived, brand-scoped connect token for an SMS deep link. */
export function mintSmsConnectToken(
  brandId: string,
  purpose: SmsConnectPurpose,
  nowMs: number = Date.now(),
): string {
  const payload = `${brandId}.${purpose}.${nowMs}`;
  const b64 = Buffer.from(payload).toString("base64url");
  return `${b64}.${sign(b64)}`;
}

export type VerifySmsConnectResult =
  | { ok: true; brandId: string; purpose: SmsConnectPurpose }
  | { ok: false; reason: "invalid" | "expired" };

/** Verify an SMS connect token. Expired links get a distinct reason so UX can ask for a fresh one. */
export function verifySmsConnectToken(
  token: string | null | undefined,
  nowMs: number = Date.now(),
  ttlMs: number = SMS_CONNECT_TTL_MS,
): VerifySmsConnectResult {
  if (!token) return { ok: false, reason: "invalid" };
  const dot = token.lastIndexOf(".");
  if (dot < 0) return { ok: false, reason: "invalid" };
  const b64 = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  let expected: string;
  try {
    expected = sign(b64);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "invalid" };

  let payload: string;
  try {
    payload = Buffer.from(b64, "base64url").toString("utf8");
  } catch {
    return { ok: false, reason: "invalid" };
  }
  const [brandId, purpose, issued] = payload.split(".");
  if (!brandId || !purpose || !isPurpose(purpose) || !issued) {
    return { ok: false, reason: "invalid" };
  }
  const issuedAt = Number(issued);
  if (!Number.isFinite(issuedAt)) return { ok: false, reason: "invalid" };
  if (nowMs - issuedAt > ttlMs) return { ok: false, reason: "expired" };
  return { ok: true, brandId, purpose };
}

/** Absolute SMS deep-link URL for a brand + purpose. */
export function smsConnectUrl(brandId: string, purpose: SmsConnectPurpose): string {
  const base = getServerEnv().APP_BASE_URL.replace(/\/$/, "");
  return `${base}/c/${mintSmsConnectToken(brandId, purpose)}`;
}
