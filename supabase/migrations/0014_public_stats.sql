-- ============================================================
-- Replace the hardcoded homepage statistics with real counts.
--
-- The site advertised "5,000+ community members, 100+ events hosted,
-- 50+ partners, 20+ cities" as fixed strings in src/lib/data.ts. None of
-- it came from the database, and the database does not support any of
-- it. That is risk R-001/R-005 in the business OS, scored 25 and 20, on
-- pages that are about to take payment.
--
-- This returns the real figures. It is security definer so the counts
-- survive row level security (0013) without exposing any row, and it
-- counts only what can be evidenced: confirmed members, events that have
-- actually happened, active partners and active cities.
--
-- Idempotent. Safe to run before or after 0013.
-- ============================================================
create or replace function public.public_stats()
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select jsonb_build_object(
    'members',  (select count(*) from public.users),
    'events',   (select count(*) from public.events
                  where status = 'published' and date < current_date),
    'partners', (select count(*) from public.partners where is_active),
    'cities',   (select count(*) from public.cities where is_active)
  );
$$;

comment on function public.public_stats() is
  $c$Aggregate counts for the public homepage. Returns numbers only, never rows.$c$;

revoke all on function public.public_stats() from public;
grant execute on function public.public_stats() to anon, authenticated;
