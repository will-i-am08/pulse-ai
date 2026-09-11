export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextResponse, type NextRequest } from "next/server";
import { sendToBrand } from "@pulse/gateway";
import { restartOnboarding } from "@pulse/orchestrator";
import { isErrorResponse, requireLabOperator } from "@/lib/lab/auth";
import { getOrCreateLabBrand, requireLabBrand } from "@/lib/lab/brand";
import { labChannelContext } from "@/lib/lab/channel";

export async function POST(request: NextRequest) {
  const auth = await requireLabOperator();
  if (isErrorResponse(auth)) return auth;

  const payload = (await request.json().catch(() => ({}))) as { brandId?: string };
  const brand = payload.brandId
    ? await requireLabBrand(payload.brandId)
    : await getOrCreateLabBrand();

  const greeting = await restartOnboarding(brand.id);
  const { channel } = labChannelContext(brand);
  await sendToBrand(brand.id, greeting, undefined, { pace: false, channel });

  return NextResponse.json({ ok: true, greeting });
}
