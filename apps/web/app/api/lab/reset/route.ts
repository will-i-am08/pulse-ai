export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse, type NextRequest } from "next/server";
import { hardResetLabBrand } from "@pulse/orchestrator";
import { isErrorResponse, requireLabOperator } from "@/lib/lab/auth";
import { getOrCreateLabBrand, requireLabBrand } from "@/lib/lab/brand";

export async function POST(request: NextRequest) {
  const auth = await requireLabOperator();
  if (isErrorResponse(auth)) return auth;

  const payload = (await request.json().catch(() => ({}))) as { brandId?: string };
  const brand = payload.brandId
    ? await requireLabBrand(payload.brandId)
    : await getOrCreateLabBrand();

  await hardResetLabBrand(brand.id);
  return NextResponse.json({ ok: true });
}
