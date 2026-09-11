// Public Kip contact card (.vcf) for Twilio MMS.
// Recipients save "Kip" + the cat logo instead of a bare +61… number.
// Headers matter: Twilio uses Content-Type + Content-Disposition when labeling
// the MMS attachment (without them iOS shows a generic "text 1").
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { buildKipVCard, kipContactIdentity } from "@pulse/shared";

export async function GET(): Promise<NextResponse> {
  const identity = kipContactIdentity();

  // Embed a small JPEG so "Add to Contacts" brings the profile pic along.
  // Large embeds sometimes fail Twilio media fetch — keep ~160px.
  let photoJpeg: Uint8Array | undefined;
  try {
    const logoPath = path.join(process.cwd(), "public", "brand", "kip-logo-1024.png");
    const png = await readFile(logoPath);
    photoJpeg = new Uint8Array(
      await sharp(png).resize(160, 160, { fit: "cover" }).jpeg({ quality: 82 }).toBuffer(),
    );
  } catch (err) {
    console.warn("kip.vcf: could not embed logo, falling back to PHOTO URI", err);
  }

  const vcard = buildKipVCard({
    firstName: identity.firstName,
    phone: identity.phone,
    imageUrl: identity.imageUrl,
    photoJpeg,
    url: process.env.APP_BASE_URL?.replace(/\/$/, "") || undefined,
  });

  return new NextResponse(vcard, {
    status: 200,
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      // `inline` + filename is what makes iOS show "Kip" instead of "text 1".
      "Content-Disposition": `inline; name="${identity.firstName}"; filename="${identity.firstName}.vcf"`,
      "Cache-Control": "public, max-age=300",
    },
  });
}
