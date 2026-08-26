-- schema.sql part 4 of 6
-- Source lines 1738-1868 of supabase/schema.sql.
-- Run the parts in order. Each is idempotent, like the whole file.

-- Optional precise coordinates. Without them the detail page falls back to
-- looking the address up, which is fine — these just make it exact.
alter table public.events add column if not exists latitude  double precision;
alter table public.events add column if not exists longitude double precision;

-- Short "good to know" facts, kept loose so hosts can add what fits.
alter table public.events add column if not exists highlights jsonb not null default '[]';

-- Shown on paid tickets, where "can I get my money back?" actually comes up.
alter table public.events add column if not exists refund_policy text;


-- ============================================================
-- Row level security
-- ============================================================

alter table public.newsletter_subscribers enable row level security;

alter table public.posts enable row level security;

alter table public.post_reactions enable row level security;

alter table public.post_comments enable row level security;

alter table public.notifications enable row level security;

alter table public.promo_codes enable row level security;

alter table public.payouts enable row level security;

alter table public.ticket_types enable row level security;

alter table public.orders enable row level security;

alter table public.event_questions enable row level security;

alter table public.saved_events enable row level security;

alter table public.organizer_follows enable row level security;

drop policy if exists "public read published events" on public.events;
create policy "public read published events" on public.events
  for select using (status = 'published' or public.is_admin());

drop policy if exists "public read speakers" on public.speakers;
create policy "public read speakers"       on public.speakers         for select using (true);

drop policy if exists "public read event_speakers" on public.event_speakers;
create policy "public read event_speakers" on public.event_speakers   for select using (true);

drop policy if exists "public read event_agenda" on public.event_agenda;
create policy "public read event_agenda"   on public.event_agenda     for select using (true);

drop policy if exists "public read plans" on public.membership_plans;
create policy "public read plans"          on public.membership_plans for select using (true);

drop policy if exists "public read benefits" on public.benefits;
create policy "public read benefits"       on public.benefits         for select using (true);

drop policy if exists "public read plan_benefits" on public.plan_benefits;
create policy "public read plan_benefits"  on public.plan_benefits    for select using (true);

drop policy if exists "public read leaders" on public.leader_profiles;
create policy "public read leaders"        on public.leader_profiles  for select using (true);

drop policy if exists "public read partners" on public.partners;
create policy "public read partners"       on public.partners         for select using (is_active or public.is_admin());

drop policy if exists "public read activities" on public.activities;
create policy "public read activities"     on public.activities       for select using (true);

drop policy if exists "public read cities" on public.cities;
create policy "public read cities"         on public.cities           for select using (true);

drop policy if exists "public read badges" on public.badges;
create policy "public read badges"         on public.badges           for select using (true);

drop policy if exists "anyone submit host proposal" on public.host_submissions;
create policy "anyone submit host proposal" on public.host_submissions      for insert with check (true);

drop policy if exists "anyone submit contact" on public.contact_messages;
create policy "anyone submit contact"       on public.contact_messages      for insert with check (true);

drop policy if exists "anyone subscribe newsletter" on public.newsletter_subscribers;
create policy "anyone subscribe newsletter" on public.newsletter_subscribers for insert with check (true);

drop policy if exists "anyone register" on public.registrations;
create policy "anyone register"             on public.registrations         for insert with check (true);

drop policy if exists "read own profile" on public.users;
create policy "read own profile"   on public.users for select using (auth.uid() = id or public.is_admin());

drop policy if exists "update own profile" on public.users;
create policy "update own profile" on public.users for update using (auth.uid() = id);

drop policy if exists "own registrations" on public.registrations;
create policy "own registrations" on public.registrations for select using (auth.uid() = user_id or public.is_admin());

drop policy if exists "own memberships" on public.memberships;
create policy "own memberships"   on public.memberships   for select using (auth.uid() = user_id or public.is_admin());

drop policy if exists "own user_badges" on public.user_badges;
create policy "own user_badges"   on public.user_badges   for select using (auth.uid() = user_id or public.is_admin());

drop policy if exists "own point_events" on public.point_events;
create policy "own point_events"  on public.point_events  for select using (auth.uid() = user_id or public.is_admin());

drop policy if exists "admin manage events" on public.events;
create policy "admin manage events"         on public.events            for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin manage submissions" on public.host_submissions;
create policy "admin manage submissions"    on public.host_submissions  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin manage partners" on public.partners;
create policy "admin manage partners"       on public.partners          for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin manage speakers" on public.speakers;
create policy "admin manage speakers"       on public.speakers          for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin manage event_speakers" on public.event_speakers;
create policy "admin manage event_speakers" on public.event_speakers    for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin manage event_agenda" on public.event_agenda;
create policy "admin manage event_agenda"   on public.event_agenda      for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin manage plans" on public.membership_plans;
create policy "admin manage plans"          on public.membership_plans  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin manage benefits" on public.benefits;
create policy "admin manage benefits"       on public.benefits          for all using (public.is_admin()) with check (public.is_admin());
