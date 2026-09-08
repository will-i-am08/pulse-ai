-- 0020_interaction_triaging.sql — Phase A: atomic claim for inbound triage.
--
-- The worker engagement loop and the Discord bot poller both consume
-- `interactions where status = 'new'`. To stop them double-triaging the same
-- row, each consumer atomically claims a row by moving it to 'triaging'
-- (see claimInteraction in @pulse/orchestrator) before processing it.
-- 'triaging' is transient: triage always ends in a terminal status
-- (auto_replied | drafted | escalated | hidden | resolved).

alter table interactions drop constraint if exists interactions_status_check;
alter table interactions add constraint interactions_status_check
  check (status in ('new','triaging','auto_replied','drafted','escalated','resolved','hidden'));
