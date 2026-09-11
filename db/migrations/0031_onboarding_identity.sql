-- Stamp completed_at on brands that already finished onboarding, so phone-save
-- / status parking cannot re-arm setup. Also seed facts.owner_name from the
-- linked user's signup name when missing so Kip stops re-asking who they are.

update brands
   set onboarding_state = jsonb_set(
         onboarding_state,
         '{completed_at}',
         to_jsonb(coalesce(onboarding_state->>'completed_at', now()::text))
       )
 where onboarding_state->>'status' = 'done'
   and onboarding_state->>'completed_at' is null;

update brands b
   set facts = coalesce(b.facts, '{}'::jsonb)
            || jsonb_build_object(
                 'owner_name',
                 split_part(trim(u.name), ' ', 1)
               )
  from users u
 where b.owner_user_id = u.id
   and coalesce(b.facts->>'owner_name', '') = ''
   and u.name is not null
   and trim(u.name) <> '';
