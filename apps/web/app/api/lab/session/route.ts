export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { isErrorResponse, requireLabOperator } from "@/lib/lab/auth";
import { getOrCreateLabBrand } from "@/lib/lab/brand";

export async function GET() {
  const auth = await requireLabOperator();
  if (isErrorResponse(auth)) return auth;

  const brand = await getOrCreateLabBrand();
  return NextResponse.json({
    brand: {
      id: brand.id,
      name: brand.name,
      client_phone: brand.client_phone,
      onboarding_state: brand.onboarding_state,
      facts: brand.facts,
    },
  });
}
