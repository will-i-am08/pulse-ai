import { NextResponse, type NextRequest } from 'next/server';
import {
  query,
  queryOne,
  encrypt,
  type Brand,
} from '@pulse/shared';
import { verifySmsConnectToken } from '@/lib/sms-connect/token';

export const dynamic = 'force-dynamic';

/**
 * Phase I optional CRM settings deep-link.
 * GET  /c/crm?t=…  → paste Zapier/Make/n8n catch-hook URL
 * POST /c/crm      → save encrypted URL + enable features.crm_webhook
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('t') ?? '';
  const verified = verifySmsConnectToken(token);
  const base = (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

  if (!verified.ok || verified.purpose !== 'crm') {
    const msg =
      verified.ok === false && verified.reason === 'expired'
        ? "This link expired. Text Kip: \"crm settings\" for a fresh one."
        : "That link isn't valid. Text Kip and ask for CRM settings.";
    return new NextResponse(page('Link expired', msg), {
      status: 410,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  const brand = await queryOne<Brand>('select * from brands where id = $1', [verified.brandId]);
  if (!brand) {
    return new NextResponse(page('Not found', "I couldn't find that brand."), {
      status: 404,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  return new NextResponse(
    page(
      'CRM webhook',
      `Paste your Zapier, Make, n8n, HubSpot, or Pipedrive catch-hook URL for <strong>${escapeHtml(brand.name)}</strong>. Kip will POST a lead card JSON when a qualified lead comes in.`,
      `<form method="POST" action="${base}/c/crm">
        <input type="hidden" name="t" value="${escapeAttr(token)}" />
        <label style="display:block;margin:1rem 0 .5rem;color:#444">Webhook URL (https)
          <input name="url" type="url" required placeholder="https://hooks.zapier.com/…"
            style="display:block;width:100%;margin-top:6px;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:1rem"/>
        </label>
        <button type="submit" style="padding:12px 18px;border-radius:8px;border:0;background:#1a1a1a;color:#fff;font-size:1rem;cursor:pointer;margin-top:8px">
          Save webhook
        </button>
      </form>
      <p style="margin-top:1.5rem;font-size:.9rem;color:#666">Or text Kip: <code>set crm webhook https://…</code></p>`,
    ),
    { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const token = String(form.get('t') ?? '');
  const url = String(form.get('url') ?? '').trim();
  const verified = verifySmsConnectToken(token);
  const base = (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

  if (!verified.ok || verified.purpose !== 'crm') {
    return NextResponse.redirect(new URL('/c/done?status=invalid', base));
  }

  if (!/^https:\/\//i.test(url)) {
    return NextResponse.redirect(new URL(`/c/crm?t=${encodeURIComponent(token)}&error=https`, base));
  }

  let enc: string;
  try {
    enc = encrypt(url);
  } catch {
    return NextResponse.redirect(new URL('/c/done?status=failed', base));
  }

  const brand = await queryOne<Brand>('select * from brands where id = $1', [verified.brandId]);
  if (!brand) {
    return NextResponse.redirect(new URL('/c/done?status=nobrand', base));
  }

  const features = { ...(brand.features ?? {}), crm_webhook: true };
  await query(
    `update brands set crm_webhook_url = $1, features = $2::jsonb where id = $3`,
    [enc, JSON.stringify(features), brand.id],
  );

  return new NextResponse(
    page(
      'CRM webhook saved',
      'All set. Close this and head back to your texts — Kip will push qualified leads automatically. You can also say "send to CRM" anytime.',
    ),
    { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function page(title: string, body: string, extra = ''): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title} · Kip</title>
<style>
  body{font-family:ui-sans-serif,system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1.25rem;color:#1a1a1a;line-height:1.5}
  h1{font-size:1.35rem;margin:0 0 .75rem}
  p{margin:0 0 1rem;color:#444}
  a{color:#0b5fff}
  code{font-size:.85em;background:#f4f4f4;padding:2px 6px;border-radius:4px}
</style></head>
<body><h1>${title}</h1><p>${body}</p>${extra}</body></html>`;
}
