-- ============================================================
-- Techxfluence — one pending host submission per event category
-- From the test host (host@txf.test). Run seed_test_users.sql first.
-- ============================================================
insert into public.host_submissions
  (title, category, date, city, venue, organizer_email, organizer_id, description, status)
select
  c.cat || ' — Test Submission',
  c.cat::event_category,
  current_date + c.n,
  'Chennai',
  'Test Venue, Anna Salai',
  'host@txf.test',
  u.id,
  'Auto-generated ' || c.cat || ' submission for testing the host → admin approval flow.',
  'pending'
from (values
  ('Meetup', 7), ('Workshop', 14), ('Webinar', 21), ('Hackathon', 28),
  ('Conference', 35), ('Networking', 42), ('Product Launch', 49)
) as c(cat, n)
cross join (select id from public.users where email = 'host@txf.test') u;
