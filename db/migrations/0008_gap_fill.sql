-- 0008_gap_fill.sql — proactive gap-fill bookkeeping.
-- last_gap_ping_at throttles how often the agent nudges the client about an
-- empty upcoming slot for a pillar (at most once a day per pillar).

alter table pillars add column if not exists last_gap_ping_at timestamptz;
