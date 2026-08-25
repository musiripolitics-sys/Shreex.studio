-- ============================================================
-- Techxfluence — approved hosts create their own events.
-- Trust model: an admin approves the HOST once (host_status =
-- 'approved' → primary_role = 'event_host'); after that the host
-- publishes their own events without per-event review.
-- WITH CHECK pins host_id to the caller and requires is_host(),
-- so a plain member can never insert an event.
-- Run once. Idempotent.
-- ============================================================
drop policy if exists "host create own events" on public.events;
create policy "host create own events" on public.events
  for insert
  with check (host_id = auth.uid() and public.is_host());

-- Hosts may also remove their own events (e.g. created by mistake).
drop policy if exists "host delete own events" on public.events;
create policy "host delete own events" on public.events
  for delete
  using (host_id = auth.uid());
