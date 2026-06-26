-- ============================================================
-- Techxfluence — role system (Admin / Host / Community Member)
-- Adds role helpers, role-at-signup, and Host permissions.
-- Run in the Supabase SQL Editor.
-- ============================================================

-- ---------- is_admin(): honor primary_role='admin' OR a user_roles admin row ----------
create or replace function public.is_admin()
returns boolean language sql security definer set search_path = public as $$
  select
    exists (select 1 from public.users      where id = auth.uid() and primary_role = 'admin')
    or
    exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin');
$$;

-- ---------- is_host(): hosts (and admins) ----------
create or replace function public.is_host()
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and primary_role in ('event_host', 'admin')
  );
$$;

-- ---------- Capture role at signup (Community Member or Host only — never Admin) ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email, full_name, phone, city, primary_role)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    nullif(new.raw_user_meta_data->>'phone', ''),
    nullif(new.raw_user_meta_data->>'city', ''),
    case
      when new.raw_user_meta_data->>'role' = 'event_host' then 'event_host'::user_role
      else 'community_member'::user_role
    end
  )
  on conflict (id) do nothing;
  return new;
end; $$;

-- ============================================================
-- Host permissions (RLS)
-- ============================================================

-- Hosts read their own submissions; edit/resubmit only when declined.
create policy "host read own submissions" on public.host_submissions
  for select using (organizer_id = auth.uid());

create policy "host resubmit declined" on public.host_submissions
  for update using (organizer_id = auth.uid() and status = 'declined')
  with check (organizer_id = auth.uid());

-- Hosts can see their own events even before they're published.
create policy "host read own events" on public.events
  for select using (host_id = auth.uid());

-- Hosts read + manage registrations for events they own (attendee management).
create policy "host read event registrations" on public.registrations
  for select using (
    exists (
      select 1 from public.events e
      where e.id = registrations.event_id and e.host_id = auth.uid()
    )
  );

create policy "host manage event registrations" on public.registrations
  for update using (
    exists (
      select 1 from public.events e
      where e.id = registrations.event_id and e.host_id = auth.uid()
    )
  );
