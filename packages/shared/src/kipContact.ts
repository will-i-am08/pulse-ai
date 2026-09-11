/**
 * Kip's messaging identity — the name + profile image clients should see
 * instead of a bare Twilio/Linq phone number.
 *
 * Linq: native iMessage Name and Photo Sharing (contact_card API).
 * Twilio: MMS vCard (.vcf) attached on the first outbound to each brand.
 */

import { getServerEnv } from "./env.js";

export type KipContactIdentity = {
  firstName: string;
  /** E.164 line on the contact card (Twilio from-number, or Linq from-number). */
  phone: string | undefined;
  /** Public HTTPS URL for the profile image. */
  imageUrl: string;
  /** Public HTTPS URL for the hosted .vcf (Twilio MediaUrl). */
  vcardUrl: string;
};

/** Resolve Kip's contact identity from env (safe defaults for name + logo). */
export function kipContactIdentity(): KipContactIdentity {
  const env = getServerEnv();
  const base = env.APP_BASE_URL.replace(/\/$/, "");
  return {
    firstName: env.KIP_CONTACT_FIRST_NAME,
    // Prefer the active channel's from-number; fall back across providers.
    phone: env.TWILIO_FROM_NUMBER ?? env.LINQ_FROM_NUMBER,
    // Opaque off-white square (not the transparent web mark) — iMessage /
    // JPEG vCards turn transparent corners black.
    imageUrl: env.KIP_CONTACT_IMAGE_URL ?? `${base}/brand/kip-contact-avatar.png`,
    vcardUrl: `${base}/api/contact/kip.vcf`,
  };
}

/**
 * Build a vCard 3.0 string for Kip. Optionally embed a JPEG photo as base64
 * (best for phone import); otherwise reference imageUrl as PHOTO;VALUE=URI.
 * Lines are folded per RFC 6350 so long PHOTO payloads stay valid.
 */
export function buildKipVCard(opts: {
  firstName: string;
  phone?: string;
  imageUrl?: string;
  /** Raw JPEG bytes to embed as PHOTO;ENCODING=b. Prefer small (~160px) images. */
  photoJpeg?: Uint8Array;
  url?: string;
}): string {
  const lines: string[] = ["BEGIN:VCARD", "VERSION:3.0", `FN:${escapeVCard(opts.firstName)}`, "N:;;;;", "ORG:Kip"];
  if (opts.phone) {
    lines.push(`TEL;TYPE=CELL,VOICE:${opts.phone}`);
  }
  if (opts.url) {
    lines.push(`URL:${opts.url}`);
  }
  if (opts.photoJpeg && opts.photoJpeg.length > 0) {
    const b64 = Buffer.from(opts.photoJpeg).toString("base64");
    lines.push(foldVCardLine(`PHOTO;ENCODING=b;TYPE=JPEG:${b64}`));
  } else if (opts.imageUrl) {
    lines.push(`PHOTO;VALUE=URI:${opts.imageUrl}`);
  }
  lines.push("END:VCARD");
  return lines.join("\r\n") + "\r\n";
}

function escapeVCard(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/** Fold a single vCard line to ≤75 octets with CRLF + space continuations. */
export function foldVCardLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let remaining = line;
  chunks.push(remaining.slice(0, 75));
  remaining = remaining.slice(75);
  while (remaining.length > 0) {
    chunks.push(" " + remaining.slice(0, 74));
    remaining = remaining.slice(74);
  }
  return chunks.join("\r\n");
}
