-- ============================================================
-- Techxfluence — wipe all events, seed one online AI event.
-- Deleting events cascades to registrations, speakers links,
-- agenda rows and session-group posts.
-- ============================================================

-- Detach approved submissions from their published events first.
update public.host_submissions set published_event_id = null;

delete from public.events;

insert into public.events
  (slug, title, category, date, date_label, time, city, venue, address,
   price_type, price_label, price_amount, blurb, about, capacity, spots_left,
   image_url, status, source, published_at)
values (
  'ai-powered-software-development',
  'AI-Powered Software Development',
  'Webinar',
  '2026-07-18',
  'Jul 18, 2026',
  '7:00 PM – 8:30 PM IST',
  'Online',
  'Live online session',
  'Online — join link emailed after registration',
  'Free', 'Free', 0,
  'How real teams ship faster with AI — copilots, agents, and code review that writes itself.',
  'A live, online deep-dive into building software with AI in the loop. We''ll cover practical workflows with coding copilots and autonomous agents, prompt-driven development, AI-assisted code review and testing, and where human judgment still matters. Ends with an open Q&A — bring your current workflow and we''ll talk through how to level it up. The join link is emailed to everyone who registers.',
  500, 500,
  '/events/webinar.jpg',
  'published', 'system', now()
);
