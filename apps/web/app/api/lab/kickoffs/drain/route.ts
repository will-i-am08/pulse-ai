export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse, type NextRequest } from "next/server";
import { isErrorResponse, requireLabOperator } from "@/lib/lab/auth";
import { requireLabBrand } from "@/lib/lab/brand";
import { labChannelContext } from "@/lib/lab/channel";
import { runLabKickoffContinuation } from "@/lib/kickoffs/scheduleLabDrain";

/**
 * Fresh-isolate Lab kickoff continuation. The primary `/api/lab/message`
 * after() drain shares a 300s wall with photo carousels; when that isolate is
 * killed, this route requeues abandoned `running` rows and drains again with
 * a new 300s budget (lab channel only).
 */
export async function POST(request: NextRequest) {
  const auth = await requireLabOperator();
  if (isErrorResponse(auth)) return auth;

  let brandId = "";
  try {
    const body = (await request.json()) as { brandId?: string };
    brandId = String(body?.brandId ?? "");
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!brandId) {
    return NextResponse.json({ error: "brandId required" }, { status: 400 });
  }

  const brand = await requireLabBrand(brandId);
  const { channel } = labChannelContext(brand);

  try {
    const result = await runLabKickoffContinuation(brand.id, channel);
    console.info("[kickoffs] lab continuation finished", { brandId: brand.id, ...result });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error(
      "[kickoffs] lab continuation failed",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      { error: "drain_failed", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
