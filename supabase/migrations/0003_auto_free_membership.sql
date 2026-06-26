-- ============================================================
-- Techxfluence — Automatically Grant Free Membership on Signup
-- Updates handle_new_user() trigger function to link new users
-- to the 'Free' membership plan automatically.
-- ============================================================

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  free_plan_id uuid;
begin
  -- 1. Create the user profile
  insert into public.users (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;

  -- 2. Retrieve the plan ID of the 'Free' tier
  select id into free_plan_id from public.membership_plans where tier = 'Free';

  -- 3. Automatically link user to the 'Free' membership
  if free_plan_id is not null then
    insert into public.memberships (user_id, plan_id, tier, status)
    values (new.id, free_plan_id, 'Free', 'active')
    on conflict do nothing;
  end if;

  return new;
end; $$;
