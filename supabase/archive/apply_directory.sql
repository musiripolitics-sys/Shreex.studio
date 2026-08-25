-- ============================================================
-- Techxfluence — member directory (opt-in, privacy-safe). Run once. Idempotent.
-- Members are hidden by default; they opt in via `discoverable`.
-- The directory is served by a SECURITY DEFINER *function* that returns ONLY
-- safe columns of opted-in members (never email/phone). A function (with a
-- fixed search_path) is used instead of a view so it keeps column-level
-- privacy without tripping the "security definer view" database linter.
-- ============================================================
alter table public.users
  add column if not exists discoverable boolean not null default false;

-- Remove the earlier view if it was created.
drop view if exists public.directory_profiles;

create or replace function public.get_directory()
returns table (
  id           uuid,
  full_name    text,
  city         text,
  bio          text,
  linkedin_url text,
  primary_role text
)
language sql
security definer
set search_path = public
as $$
  select id, full_name, city, bio, linkedin_url, primary_role::text
  from public.users
  where discoverable = true
  order by full_name;
$$;

revoke all on function public.get_directory() from public;
grant execute on function public.get_directory() to authenticated;
