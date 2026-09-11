-- 0039_ops_polish.sql — drop unused Discord brand columns (SMS-only) + retention notes.
-- Discord channel was removed in Phase A; these columns are dead weight.

drop index if exists idx_brands_discord;
alter table brands drop column if exists discord_channel_id;
alter table brands drop column if exists discord_user_id;

-- AI spend tracking lives in brands.facts.ai_spend (jsonb), not a new column.
-- Retention: worker weekly purge of design_memory / research_snapshots older than
-- RETENTION_DAYS (default 180) — see apps/worker/src/proactive/retention.ts.
