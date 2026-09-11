export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { listLabChats } from "@pulse/orchestrator";
import { publicMediaUrl, query } from "@pulse/shared";
import { isErrorResponse, requireLabOperator } from "@/lib/lab/auth";
import { getOrCreateLabBrand, requireLabBrand } from "@/lib/lab/brand";

type NoteRow = {
  id: string;
  brand_id: string;
  target_type: string;
  target_id: string;
  body: string;
  created_at: string;
  updated_at: string;
  lab_chat_id: string | null;
};

type MessageRow = {
  id: string;
  direction: string;
  channel: string;
  body: string | null;
  media_ids: string[];
  type: string | null;
  provider_message_sid: string | null;
  created_at: string;
};

export async function GET(request: NextRequest) {
  const auth = await requireLabOperator();
  if (isErrorResponse(auth)) return auth;

  const brandId = request.nextUrl.searchParams.get("brandId");
  const chatId = request.nextUrl.searchParams.get("chatId");
  const brand = brandId ? await requireLabBrand(brandId) : await getOrCreateLabBrand();
  const chats = await listLabChats(brand.id);
  const viewingArchive = Boolean(chatId);

  let messages: MessageRow[];
  if (chatId) {
    const owned = chats.find((c) => c.id === chatId);
    if (!owned) {
      return NextResponse.json({ error: "chat not found" }, { status: 404 });
    }
    messages = await query<MessageRow>(
      `select id, direction, channel, body, media_ids, type, provider_message_sid, created_at
         from lab_chat_messages
        where chat_id = $1
        order by created_at asc
        limit 500`,
      [chatId],
    );
  } else {
    messages = await query<MessageRow>(
      `select id, direction, channel, body, media_ids, type, provider_message_sid, created_at
         from messages
        where brand_id = $1
        order by created_at asc
        limit 500`,
      [brand.id],
    );
  }

  const notes = await query<NoteRow>(
    chatId
      ? `select * from lab_notes where brand_id = $1 and lab_chat_id = $2 order by created_at asc`
      : `select * from lab_notes where brand_id = $1 and lab_chat_id is null order by created_at asc`,
    chatId ? [brand.id, chatId] : [brand.id],
  );

  const actions = viewingArchive
    ? []
    : await query<{
        id: string;
        post_id: string | null;
        action: string;
        actor: string | null;
        note: string | null;
        created_at: string;
      }>(
        `select id, post_id, action, actor, note, created_at
           from approval_log
          where brand_id = $1
          order by created_at desc
          limit 50`,
        [brand.id],
      );

  const posts = viewingArchive
    ? []
    : await query<{
        id: string;
        caption: string | null;
        status: string;
        platform: string;
        media_ids: string[];
        created_at: string;
        updated_at: string;
      }>(
        `select id, caption, status, platform, media_ids, created_at, updated_at
           from posts
          where brand_id = $1
          order by created_at desc
          limit 20`,
        [brand.id],
      );

  const notesByTarget = new Map<string, NoteRow[]>();
  for (const n of notes) {
    const key = `${n.target_type}:${n.target_id}`;
    const list = notesByTarget.get(key) ?? [];
    list.push(n);
    notesByTarget.set(key, list);
  }

  return NextResponse.json({
    brand: {
      id: brand.id,
      name: brand.name,
      client_phone: brand.client_phone,
      onboarding_state: brand.onboarding_state,
      facts: brand.facts,
    },
    chats,
    activeChatId: chatId,
    readOnly: viewingArchive,
    messages: messages.map((m) => ({
      ...m,
      media: (m.media_ids ?? []).map((id) => ({
        id,
        url: publicMediaUrl(id),
      })),
      notes: notesByTarget.get(`message:${m.id}`) ?? [],
    })),
    actions: actions.map((a) => ({
      ...a,
      notes: notesByTarget.get(`approval_log:${a.id}`) ?? [],
    })),
    posts: posts.map((p) => ({
      ...p,
      media: (p.media_ids ?? []).map((id) => ({
        id,
        url: publicMediaUrl(id),
      })),
      notes: notesByTarget.get(`post:${p.id}`) ?? [],
    })),
    onboardingNotes: notesByTarget.get(`onboarding:${brand.id}`) ?? [],
  });
}
