-- 0021_pillar_schedule_pin.sql — optional pinned posting slot per pillar.
-- By default the scheduler shuffles windows so content doesn't land at the exact
-- same time every week. When the client asks for a fixed slot ("BTS every Tuesday
-- at 6pm", "promos on the 1st at 9am"), configurePillarsFromMessage stores it here
-- and the scheduler honours the pin before falling back to shuffled windows.
--   {} (or mode 'flex') ......... no pin, fully shuffled (default)
--   {mode:'weekly', weekdays:[2], hour:18, minute:0} .. every Tuesday 6:00pm
--   {mode:'monthly', monthDays:[1], hour:9, minute:0} .. on the 1st at 9:00am
-- weekdays use JS getDay() numbering: 0=Sunday … 6=Saturday.

alter table pillars add column if not exists schedule_pin jsonb not null default '{}'::jsonb;
