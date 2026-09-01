-- 0002_add_edit_message_type.sql
-- The orchestrator classifies inbound edits distinctly ("make it shorter",
-- "swap the last line"). 0001 had no 'edit' value on messages.type, so edits
-- were being recorded as 'instruction' — muddying the audit trail. Add 'edit'
-- so the conversation history reflects what actually happened.

alter table messages drop constraint if exists messages_type_check;
alter table messages add constraint messages_type_check
  check (type in ('media', 'instruction', 'approval', 'question', 'edit', 'other'));
