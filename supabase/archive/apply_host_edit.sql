-- ============================================================
-- Techxfluence — let hosts manage their own live events.
-- Previously hosts could only READ their events, so any change
-- (venue, time, description, unpublishing) needed an admin.
-- The WITH CHECK keeps host_id pinned to themselves, so a host
-- can never reassign an event to someone else.
-- Run once. Idempotent.
-- ============================================================
drop policy if exists "host update own events" on public.events;
create policy "host update own events" on public.events
  for update
  using (host_id = auth.uid())
  with check (host_id = auth.uid());
