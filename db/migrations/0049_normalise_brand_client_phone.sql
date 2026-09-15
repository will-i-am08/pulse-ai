-- 0049_normalise_brand_client_phone.sql
--
-- `resolveBrandByPhone` matches Twilio's strict E.164 `From` exactly, so any
-- brand row whose client_phone was stored un-normalised (e.g. "0412 345 678",
-- "+61 412 345 678") can never be resolved: inbound is dropped as an unknown
-- sender and outbound fails. `createBrandAction` now normalises on write; this
-- backfills the rows created before that.
--
-- DELIBERATELY CONSERVATIVE. It only rewrites rows it can normalise with
-- certainty, and leaves everything else untouched:
--   * "+<8-15 digits>" (after stripping spaces/brackets/dashes) -> tidied
--   * "00<digits>"     -> "+<digits>"          (explicit intl. dialling)
--   * "04XXXXXXXX"     -> "+614XXXXXXXX"       (AU mobile; NZ has no 10-digit 04)
--   * "614XXXXXXXX"    -> "+614XXXXXXXX"       (AU mobile missing its "+")
-- Ambiguous trunk-0 numbers (02/03/07/08..., which could be an AU landline OR
-- an NZ mobile) are NOT touched — guessing there is how a client's number
-- becomes a stranger's number. `signup:<uuid>` placeholders are excluded by the
-- phone-shape filter.
--
-- Idempotent: re-running is a no-op (already-normalised rows do not change), and
-- a rewrite that would collide with another brand's number is skipped so the
-- UNIQUE constraint on brands.client_phone can never abort the migration.

do $$
declare
  updated_count int;
  skipped_count int;
begin
  with stripped as (
    select
      id,
      client_phone as old_phone,
      regexp_replace(client_phone, '[[:space:]().-]', '', 'g') as digits
    from brands
    where client_phone is not null
      -- Phone-shaped only: leading + or digit, then digits/punctuation. This
      -- filter is what keeps "signup:<uuid>" placeholders out.
      and client_phone ~ '^[+0-9][0-9[:space:]().-]*$'
  ),
  normalised as (
    select
      id,
      old_phone,
      case
        when digits ~ '^\+[0-9]{8,15}$'  then digits
        when digits ~ '^00[0-9]{8,15}$'  then '+' || substring(digits from 3)
        when digits ~ '^04[0-9]{8}$'     then '+61' || substring(digits from 2)
        when digits ~ '^614[0-9]{8}$'    then '+' || digits
        else null
      end as new_phone
    from stripped
  ),
  changed as (
    select id, old_phone, new_phone
    from normalised
    where new_phone is not null
      and new_phone is distinct from old_phone
  ),
  applied as (
    update brands b
       set client_phone = c.new_phone
      from changed c
     where b.id = c.id
       -- Never trip the UNIQUE constraint: if some other brand already holds the
       -- normalised number, leave this row alone for a human to reconcile.
       and not exists (
         select 1 from brands other
          where other.client_phone = c.new_phone
            and other.id <> b.id
       )
    returning b.id
  )
  select
    (select count(*) from applied),
    (select count(*) from changed) - (select count(*) from applied)
  into updated_count, skipped_count;

  raise notice '0049: normalised % brands.client_phone row(s); % skipped due to a number collision', updated_count, skipped_count;
end $$;

-- Report (not enforce) the leftovers: adding a CHECK constraint here would make
-- the migration fail on legacy rows, which is worse than a visible warning.
do $$
declare
  leftover int;
begin
  select count(*) into leftover
    from brands
   where client_phone !~ '^\+[0-9]{8,15}$'
     and client_phone not like 'signup:%';
  if leftover > 0 then
    raise warning '0049: % brands.client_phone row(s) are still not E.164 and will not match inbound SMS — fix these manually', leftover;
  end if;
end $$;
