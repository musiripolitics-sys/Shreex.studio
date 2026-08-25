-- ============================================================
-- Techxfluence — denormalised host name on events so the public
-- event page can show "Hosted by …" without exposing the private
-- users table. Run once. Idempotent.
-- ============================================================
alter table public.events add column if not exists host_name text;

-- Backfill from each event's host profile.
update public.events e
set host_name = u.full_name
from public.users u
where e.host_id = u.id and e.host_name is null;
