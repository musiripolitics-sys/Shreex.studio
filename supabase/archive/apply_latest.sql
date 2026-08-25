-- ============================================================
-- Techxfluence — LATEST UPDATES (idempotent)
-- Brings the DB up to date: user management + onboarding fields
-- + role system (Admin/Host/Member) + host approval workflow.
-- Safe to run multiple times. Run once in the Supabase SQL Editor.
-- ============================================================

-- ---------- Host-approval state on the profile ----------
--   none / pending / approved / rejected
alter table public.users
  add column if not exists host_status text not null default 'none';

-- ---------- Role helper functions ----------
create or replace function public.is_admin()
returns boolean language sql security definer set search_path = public as $$
  select
    exists (select 1 from public.users      where id = auth.uid() and primary_role = 'admin')
    or
    exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin');
$$;

create or replace function public.is_host()
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and primary_role in ('event_host', 'admin')
  );
$$;

-- ---------- Signup: start as community_member; flag host requests as pending ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email, full_name, phone, city, primary_role, host_status)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    nullif(new.raw_user_meta_data->>'phone', ''),
    nullif(new.raw_user_meta_data->>'city', ''),
    'community_member',
    case when new.raw_user_meta_data->>'role' = 'event_host' then 'pending' else 'none' end
  )
  on conflict (id) do nothing;
  return new;
end; $$;

-- ---------- user_roles policies ----------
drop policy if exists "read own roles" on public.user_roles;
create policy "read own roles" on public.user_roles
  for select using (auth.uid() = user_id or public.is_admin());

drop policy if exists "admin manage roles" on public.user_roles;
create policy "admin manage roles" on public.user_roles
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- Admins can update any profile (roles, host_status, primary_role) ----------
drop policy if exists "admin update users" on public.users;
create policy "admin update users" on public.users
  for update using (public.is_admin()) with check (public.is_admin());

-- ---------- Host permissions ----------
drop policy if exists "host read own submissions" on public.host_submissions;
create policy "host read own submissions" on public.host_submissions
  for select using (organizer_id = auth.uid());

drop policy if exists "host resubmit declined" on public.host_submissions;
create policy "host resubmit declined" on public.host_submissions
  for update using (organizer_id = auth.uid() and status = 'declined')
  with check (organizer_id = auth.uid());

drop policy if exists "host read own events" on public.events;
create policy "host read own events" on public.events
  for select using (host_id = auth.uid());

drop policy if exists "host read event registrations" on public.registrations;
create policy "host read event registrations" on public.registrations
  for select using (
    exists (select 1 from public.events e
            where e.id = registrations.event_id and e.host_id = auth.uid())
  );

drop policy if exists "host manage event registrations" on public.registrations;
create policy "host manage event registrations" on public.registrations
  for update using (
    exists (select 1 from public.events e
            where e.id = registrations.event_id and e.host_id = auth.uid())
  );

-- ---------- Make sure YOUR account is an admin (edit the email!) ----------
-- update public.users set primary_role = 'admin' where email = 'YOUR_ADMIN_EMAIL';
