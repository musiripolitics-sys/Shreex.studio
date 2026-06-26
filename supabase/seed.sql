-- ============================================================
-- Techxfluence — seed config data (from src/lib/data.ts)
-- Run AFTER 0001_init.sql. Safe to re-run (uses upserts where possible).
-- ============================================================

-- ---------- Membership plans (tiers). Amounts in paise. ----------
insert into public.membership_plans (tier, name, price_amount, cadence, tagline, is_highlight, cta_label, sort_order) values
  ('Free',  'Free Member',  0,      'forever',   'Get plugged into the community.', false, 'Join Free',     1),
  ('Pro',   'Pro Member',   49900,  'per month', 'For builders who show up.',       true,  'Go Pro',        2),
  ('Elite', 'Elite Member', 149900, 'per month', 'Lead, mentor and get recognised.',false, 'Become Elite',  3)
on conflict (tier) do update set
  name = excluded.name, price_amount = excluded.price_amount, cadence = excluded.cadence,
  tagline = excluded.tagline, is_highlight = excluded.is_highlight, cta_label = excluded.cta_label;

-- ---------- Plan perks (free-text, mirrors tiers.perks) ----------
delete from public.plan_benefits;  -- reset perk list on re-seed
insert into public.plan_benefits (plan_id, perk_text)
select p.id, perk from public.membership_plans p
cross join lateral (values
  ('Access to community channels'),('Entry to select free events'),
  ('Monthly newsletter & resources'),('Community badge')
) as t(perk) where p.tier = 'Free';
insert into public.plan_benefits (plan_id, perk_text)
select p.id, perk from public.membership_plans p
cross join lateral (values
  ('Everything in Free'),('Free entry to most paid events'),('Priority registration'),
  ('Member-only workshops'),('Partner discounts & perks'),('Exclusive learning resources')
) as t(perk) where p.tier = 'Pro';
insert into public.plan_benefits (plan_id, perk_text)
select p.id, perk from public.membership_plans p
cross join lateral (values
  ('Everything in Pro'),('Leadership & speaking opportunities'),('1:1 mentorship matching'),
  ('Featured on the Leadership Board'),('Early access to launches & sponsors'),
  ('Annual recognition & certificates')
) as t(perk) where p.tier = 'Elite';

-- ---------- Member benefits ----------
insert into public.benefits (title, description, icon, tag, sort_order) values
  ('Free / Discounted Access','Walk into select events on us, or grab member-only pricing on everything else.','ticket','Save money',1),
  ('Priority Registration','Skip the queue for limited-seat workshops and hackathons.','clock','Skip the line',2),
  ('Exclusive Events','Member-only sessions, founder dinners and late-night hack nights.','sparkle','Insider access',3),
  ('Networking','Curated introductions to founders, engineers, designers and investors.','nodes','Connections',4),
  ('Learning Resources','Templates, session recordings and playbooks from every event.','book','Level up',5),
  ('Partner Discounts','Deals on developer tools, cloud credits and courses.','tag','Perks',6),
  ('Leadership Opportunities','Host tracks, mentor peers and represent Techxfluence.','trophy','Grow',7),
  ('Badges & Recognition','Earn points, badges and certificates for contributions.','medal','Status',8)
on conflict do nothing;

-- ---------- Activities ----------
insert into public.activities (title, description, accent, sort_order) values
  ('Monthly Meetups','Recurring city meetups across 20+ cities.','brand',1),
  ('Hackathons','Weekend build sprints with real prizes.','join',2),
  ('Workshops','Hands-on, expert-led skill sessions.','host',3),
  ('Startup Showcases','A stage for early teams to launch.','brand',4),
  ('Mentorship','1:1 guidance from senior operators.','join',5),
  ('Innovation Challenges','Monthly contests & open-source bounties.','host',6)
on conflict do nothing;

-- ---------- Partners ----------
insert into public.partners (name, type, sort_order) values
  ('NimbusCloud','Technology Companies',1),('ForgeAI','Technology Companies',2),
  ('StackHaus','Technology Companies',3),('Quantyx','Startups',4),
  ('ByteBazaar','Startups',5),('Hexolabs','Startups',6),
  ('Vega Ventures','Communities',7),('CampusOrbit','Colleges',8),
  ('DevMint','Technology Companies',9),('PixelForge','Startups',10),
  ('OpenLoop','Communities',11),('Nexa Media','Media Partners',12)
on conflict do nothing;
