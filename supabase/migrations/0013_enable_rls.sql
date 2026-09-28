-- ============================================================
-- Security fix: 19 tables carried 42 row level security policies
-- that were never enforced, because RLS was never enabled on them.
--
-- A policy does nothing until `enable row level security` is run on its
-- table. Until then PostgREST serves every row to anyone holding the
-- public anon key, which ships in the browser bundle by design. That
-- exposed users, payments, registrations, memberships, contact_messages,
-- host_submissions and user_roles in full.
--
-- The existing policies are correct and are left untouched. This turns
-- them on, and adds the three payments policies that checkout needs:
-- payments only had an admin policy, so enabling RLS without them would
-- have blocked every non-admin from recording their own payment.
--
-- Public pages are unaffected: they read through security definer RPCs
-- (get_directory, get_organizer, get_top_members), which bypass RLS.
--
-- Idempotent. Verify on a branch or staging database before production.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Policies checkout needs before RLS can safely be switched on
-- ------------------------------------------------------------
-- verify/route.ts and ticket-verify/route.ts insert and update payments
-- with the buyer's own session, not the service role.
drop policy if exists "own payments" on public.payments;
create policy "own payments" on public.payments
  for select using (auth.uid() = user_id or public.is_admin());

drop policy if exists "record own payment" on public.payments;
create policy "record own payment" on public.payments
  for insert with check (auth.uid() = user_id);

drop policy if exists "update own payment" on public.payments;
create policy "update own payment" on public.payments
  for update using (auth.uid() = user_id or public.is_admin())
          with check (auth.uid() = user_id or public.is_admin());

-- ------------------------------------------------------------
-- 2. Turn the existing policies on
-- ------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'activities', 'benefits', 'cities', 'contact_messages', 'event_agenda',
    'event_speakers', 'events', 'host_submissions', 'leader_profiles',
    'membership_plans', 'memberships', 'partners', 'payments',
    'plan_benefits', 'registrations', 'speakers', 'sponsorships',
    'user_roles', 'users'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------
-- 3. Refuse to leave a table enforcing nothing
-- ------------------------------------------------------------
-- RLS with no policy denies everyone, including the application, which
-- fails as a blank page rather than an error. Fail the migration loudly
-- instead of shipping that.
do $$
declare v_bad text;
begin
  select string_agg(c.relname, ', ')
    into v_bad
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and c.relrowsecurity
     and not exists (select 1 from pg_policy p where p.polrelid = c.oid);
  if v_bad is not null then
    raise exception 'RLS enabled with no policy on: %', v_bad;
  end if;
end $$;
