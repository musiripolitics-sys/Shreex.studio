-- ============================================================
-- Techxfluence — Host approval workflow (idempotent)
-- Signing up as Host creates an ACTIVE community member whose
-- host access is "pending" until an admin approves it.
-- Run in the Supabase SQL Editor (safe to re-run).
-- ============================================================

-- Track host-access request state on the profile.
--   none      → regular community member (no host request)
--   pending   → requested host access, awaiting admin approval
--   approved  → admin granted host access (primary_role = event_host)
--   rejected  → admin declined the host request
alter table public.users
  add column if not exists host_status text not null default 'none';

-- Signup: always start as community_member; flag host requests as pending.
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
