-- 0048_pending_inbound_processing.sql — allow in-flight claim status.
-- Linq drain used to flip rows to 'done' before capture succeeded, so photos
-- could be marked done and never land in media_assets. 'processing' lets the
-- worker claim without lying about success.

alter table pending_inbound
  drop constraint if exists pending_inbound_status_check;

alter table pending_inbound
  add constraint pending_inbound_status_check
  check (status in ('new', 'processing', 'done', 'failed'));
