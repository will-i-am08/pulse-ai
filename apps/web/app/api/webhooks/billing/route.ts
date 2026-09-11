import { NextResponse, type NextRequest } from "next/server";
import { queryOne, type Brand } from "@pulse/shared";
import { kickOffOnboardingAfterPayment } from "@pulse/orchestrator";
import { sendToBrand } from "@pulse/gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Billing webhook / payment-submitted kickoff.
 *
 * Stripe (or another processor) should call this as soon as payment clears.
 * Payment UI is not wired yet — this is the single entry point that starts
 * greeting + connect-first onboarding over SMS.
 *
 * Expected JSON body (temporary contract until Stripe is integrated):
 *   { "brandId": "<uuid>", "event": "payment_submitted" }
 *
 * Optional shared secret: BILLING_WEBHOOK_SECRET (Authorization: Bearer …).
 */
export async function POST(request: NextRequest) {
  const secret = process.env.BILLING_WEBHOOK_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  const body = (await request.json().catch(() => null)) as {
    brandId?: string;
    event?: string;
  } | null;

  if (!body?.brandId) {
    return NextResponse.json({ ok: false, error: "brandId required" }, { status: 400 });
  }
  if (body.event && body.event !== "payment_submitted" && body.event !== "checkout.session.completed") {
    return NextResponse.json({ ok: true, ignored: true, event: body.event });
  }

  const brand = await queryOne<Brand>("select * from brands where id = $1", [body.brandId]);
  if (!brand) {
    return NextResponse.json({ ok: false, error: "brand not found" }, { status: 404 });
  }

  const greeting = await kickOffOnboardingAfterPayment(brand.id);
  await sendToBrand(brand.id, greeting);

  return NextResponse.json({ ok: true, brandId: brand.id, kickedOff: true });
}
