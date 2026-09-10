-- 0028_voice_analysis.sql — deep voice analysis from real post history.
-- When a client connects their accounts, the onboarding voice agent harvests
-- their past posts (Instagram, Facebook, Threads) and both images and captions,
-- then writes a detailed, human-readable voice guide plus enriched structured
-- mechanics onto brand_voice_profile (additive jsonb keys — no column change).
--
--  * voice_guide_md         the long-form voice bible (for humans + the dashboard)
--  * voice_analysis_state   tracks the async job the worker runs
--                           {status: none|pending|running|done|failed|skipped, ...}

alter table brands add column if not exists voice_guide_md text;
alter table brands
  add column if not exists voice_analysis_state jsonb not null default '{"status":"none"}'::jsonb;
