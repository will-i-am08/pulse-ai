export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { query } from "@pulse/shared";
import { isErrorResponse, requireLabOperator } from "@/lib/lab/auth";

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireLabOperator();
  if (isErrorResponse(auth)) return auth;

  const { id } = await context.params;
  await query(`delete from lab_notes where id = $1`, [id]);
  return NextResponse.json({ ok: true });
}
