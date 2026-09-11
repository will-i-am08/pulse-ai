export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { queryOne } from "@pulse/shared";
import { isErrorResponse, requireLabOperator } from "@/lib/lab/auth";
import { requireLabBrand } from "@/lib/lab/brand";

const TARGET_TYPES = new Set(["message", "approval_log", "post", "onboarding"]);

export async function POST(request: NextRequest) {
  const auth = await requireLabOperator();
  if (isErrorResponse(auth)) return auth;

  const payload = (await request.json()) as {
    brandId?: string;
    targetType?: string;
    targetId?: string;
    body?: string;
    id?: string;
  };

  if (!payload.brandId || !payload.targetType || !payload.targetId || !payload.body?.trim()) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }
  if (!TARGET_TYPES.has(payload.targetType)) {
    return NextResponse.json({ error: "invalid targetType" }, { status: 400 });
  }

  await requireLabBrand(payload.brandId);

  if (payload.id) {
    const updated = await queryOne(
      `update lab_notes
          set body = $2, updated_at = now()
        where id = $1 and brand_id = $3
      returning *`,
      [payload.id, payload.body.trim(), payload.brandId],
    );
    return NextResponse.json({ note: updated });
  }

  const created = await queryOne(
    `insert into lab_notes (brand_id, target_type, target_id, body)
     values ($1, $2, $3, $4)
     returning *`,
    [payload.brandId, payload.targetType, payload.targetId, payload.body.trim()],
  );
  return NextResponse.json({ note: created });
}
