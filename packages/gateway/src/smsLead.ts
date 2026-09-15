import {
  classifyUnknownInbound,
  parseSmsLeadSource,
  query,
  repliedWithinCooldown,
  sanitizeChatText,
  smsLeadHelpMessage,
  smsLeadRepeatMessage,
  smsLeadWelcomeMessage,
  type MessageChannel,
} from "@pulse/shared";
import { withBackoff } from "./backoff.js";

export type UnknownInboundResult = {
  replied: boolean;
  kind: "welcome" | "repeat" | "help" | "opt_out" | "skipped" | "failed";
};

type LeadRow = {
  phone: string;
  last_replied_at: string | null;
  last_provider_message_id: string | null;
};

/**
 * Reply to an unknown sender with a signup link. Does not create a brand or
 * attach a vCard — that starts after web signup + payment.
 */
export async function handleUnknownInbound(opts: {
  from: string;
  body: string;
  providerMessageId?: string | null;
  channel: MessageChannel;
}): Promise<UnknownInboundResult> {
  const from = opts.from.trim();
  if (!from) return { replied: false, kind: "skipped" };

  const body = opts.body ?? "";
  const kind = classifyUnknownInbound(body);
  const source = kind === "lead" ? parseSmsLeadSource(body) : null;
  const sid = opts.providerMessageId?.trim() || null;

  let row: LeadRow | null = null;
  try {
    const upserted = await query<LeadRow>(
      `insert into sms_leads (phone, source, last_body, last_provider_message_id, last_inbound_at)
       values ($1, $2, $3, $4, now())
       on conflict (phone) do update set
         source = coalesce(excluded.source, sms_leads.source),
         last_body = excluded.last_body,
         last_inbound_at = now(),
         last_provider_message_id = excluded.last_provider_message_id
       where excluded.last_provider_message_id is null
          or sms_leads.last_provider_message_id is distinct from excluded.last_provider_message_id
       returning phone, last_replied_at, last_provider_message_id`,
      [from, source, body || null, sid],
    );
    row = upserted[0] ?? null;
  } catch (err) {
    console.error(`handleUnknownInbound: lead upsert failed for ${from}`, err);
    return { replied: false, kind: "failed" };
  }

  if (!row) {
    // Same provider sid already applied (Twilio/Linq retry) — do not text again.
    return { replied: false, kind: "skipped" };
  }

  if (kind === "opt_out") {
    return { replied: false, kind: "opt_out" };
  }

  let replyKind: "welcome" | "repeat" | "help";
  let text: string;
  if (kind === "help") {
    replyKind = "help";
    text = smsLeadHelpMessage();
  } else if (repliedWithinCooldown(row.last_replied_at)) {
    replyKind = "repeat";
    text = smsLeadRepeatMessage(from, source ?? undefined);
  } else {
    replyKind = "welcome";
    text = smsLeadWelcomeMessage(from, source ?? undefined);
  }

  const cleaned = sanitizeChatText(text);
  try {
    await withBackoff(() => opts.channel.send({ to: from, body: cleaned }), {
      onRetry: (err, attempt) =>
        console.warn(`handleUnknownInbound: send retry ${attempt} for ${from}`, err),
    });
  } catch (err) {
    console.error(`handleUnknownInbound: send failed for ${from}`, err);
    return { replied: false, kind: "failed" };
  }

  try {
    await query(`update sms_leads set last_replied_at = now(), reply_count = reply_count + 1 where phone = $1`, [
      from,
    ]);
  } catch (err) {
    console.error(`handleUnknownInbound: failed to stamp last_replied_at for ${from}`, err);
  }

  return { replied: true, kind: replyKind };
}
