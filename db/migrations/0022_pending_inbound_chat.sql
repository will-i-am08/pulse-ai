-- 0022_pending_inbound_chat.sql — carry the Linq chat id through the queue.
-- The web webhook (serverless) sees the `message.received` payload, which
-- carries the chat id needed for typing indicators (POST /v3/chats/{chatId}/typing).
-- The bot (separate process) needs it to show "... is typing" while it works.

alter table pending_inbound
  add column if not exists chat_id text;
