-- ============================================================
-- Techxfluence — remove auto-generated test content before launch.
-- Deleting an event cascades to its registrations (FK on delete cascade).
-- Review before running.
-- ============================================================
delete from public.events where title ilike '%Test Submission%';
delete from public.host_submissions
  where organizer_email = 'host@txf.test' or title ilike '%Test Submission%';

-- Optional: also remove the seeded test accounts
-- delete from auth.users where email in ('member@txf.test','host@txf.test','admin@txf.test');
