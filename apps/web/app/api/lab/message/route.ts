export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { handleInbound } from "@pulse/gateway";
import type { InboundMedia } from "@pulse/shared";
import { isErrorResponse, requireLabOperator } from "@/lib/lab/auth";
import { getOrCreateLabBrand, requireLabBrand } from "@/lib/lab/brand";
import { labChannelContext } from "@/lib/lab/channel";
import { scheduleLabKickoffDrain } from "@/lib/kickoffs/scheduleLabDrain";

export async function POST(request: NextRequest) {
  const auth = await requireLabOperator();
  if (isErrorResponse(auth)) return auth;

  const form = await request.formData();
  const brandId = String(form.get("brandId") ?? "");
  const body = String(form.get("body") ?? "");
  const brand = brandId ? await requireLabBrand(brandId) : await getOrCreateLabBrand();

  const { channel, resolveBrand } = labChannelContext(brand);

  const media: InboundMedia[] = [];
  for (const [key, value] of form.entries()) {
    if (key !== "media" && !key.startsWith("media")) continue;
    if (typeof value === "string") continue;
    const file = value as File;
    if (!file.size) continue;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const contentType = file.type || "application/octet-stream";
    const url = channel.storeMedia(bytes, contentType);
    media.push({ url, contentType });
  }

  if (!body.trim() && media.length === 0) {
    return NextResponse.json({ error: "empty message" }, { status: 400 });
  }

  const result = await handleInbound(
    {
      from: brand.client_phone,
      to: "lab",
      body,
      media,
      providerMessageId: `lab_${randomUUID()}`,
      raw: { source: "lab", body, mediaCount: media.length },
    },
    { channel, resolveBrand },
  );

  scheduleLabKickoffDrain(brand.id, channel, "lab", {
    cookieHeader: request.headers.get("cookie") ?? undefined,
  });

  return NextResponse.json({
    brandId: result.brandId,
    messageId: result.messageId,
  });
}
