-- ============================================================
-- Techxfluence — track when a pre-event reminder was sent so the
-- reminder cron never double-emails an attendee. Run once. Idempotent.
-- ============================================================
alter table public.registrations
  add column if not exists reminded_at timestamptz;

-- Helps the cron quickly find un-reminded registrations.
create index if not exists idx_registrations_reminded
  on public.registrations (reminded_at)
  where reminded_at is null;
