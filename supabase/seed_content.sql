-- ============================================================
-- Techxfluence — content seed (leaders + ordered plan perks)
-- Run AFTER full_setup.sql in the Supabase SQL Editor.
-- Idempotent: re-seeds perks (with order) and seeds leaders only
-- if the table is empty.
-- ============================================================

-- ---------- Ordered membership perks ----------
alter table public.plan_benefits add column if not exists sort_order int not null default 0;

delete from public.plan_benefits;
insert into public.plan_benefits (plan_id, perk_text, sort_order)
select p.id, perk, ord from public.membership_plans p
cross join lateral (values
  ('Access to community channels', 1), ('Entry to select free events', 2),
  ('Monthly newsletter & resources', 3), ('Community badge', 4)
) as t(perk, ord) where p.tier = 'Free';
insert into public.plan_benefits (plan_id, perk_text, sort_order)
select p.id, perk, ord from public.membership_plans p
cross join lateral (values
  ('Everything in Free', 1), ('25% off all paid event tickets', 2), ('Priority registration', 3),
  ('Member-only workshops', 4), ('Partner discounts & perks', 5), ('Exclusive learning resources', 6)
) as t(perk, ord) where p.tier = 'Pro';
insert into public.plan_benefits (plan_id, perk_text, sort_order)
select p.id, perk, ord from public.membership_plans p
cross join lateral (values
  ('Everything in Pro, plus 50% off all tickets', 1), ('Leadership & speaking opportunities', 2), ('1:1 mentorship matching', 3),
  ('Featured on the Leadership Board', 4), ('Early access to launches & sponsors', 5),
  ('Annual recognition & certificates', 6)
) as t(perk, ord) where p.tier = 'Elite';

-- ---------- Leadership board (seed only if empty) ----------
do $$
begin
  if not exists (select 1 from public.leader_profiles) then
    insert into public.leader_profiles
      (display_name, role, city, focus, bio, events_count, points, is_hiring, image_url, sort_order)
    values
      ('Kumaresan', 'Founder', 'Chennai', 'Vision & Strategy',
        'Leading Techxfluence to build India''s strongest community for creators and innovators.',
        64, 9820, false, '/team/kumaresan.png', 1),
      ('Mahalakshmi', 'Community Lead', 'Chennai', 'Member Experience',
        'Fostering collaboration and growing the Techxfluence volunteer network.',
        41, 7430, false, '/team/mahalakshmi.png', 2),
      ('Abishek', 'Community Lead', 'Bengaluru', 'Ambassador Relations',
        'Connecting campus leads and driving technology events across chapters.',
        35, 6610, false, '/team/abishek.png', 3),
      ('Open Coordinator (Chennai)', 'Event Coordinator', 'Chennai', 'Event Ops',
        'Join as Event Coordinator to organize hackathons, meetups and tech events.',
        0, 0, true, null, 4),
      ('Open Ambassador (Chennai)', 'Ambassador', 'Chennai', 'Community Growth',
        'Join as Community Ambassador to lead your local chapter.',
        0, 0, true, null, 5),
      ('Open Mentor (Chennai)', 'Mentor', 'Chennai', 'Technical Guidance',
        'Join as Tech Mentor to support builders in system design and product.',
        0, 0, true, null, 6),
      ('Open Coordinator (Bengaluru)', 'Event Coordinator', 'Bengaluru', 'Event Ops',
        'Join as Event Coordinator to organize hackathons, meetups and tech events.',
        0, 0, true, null, 7),
      ('Open Ambassador (Bengaluru)', 'Ambassador', 'Bengaluru', 'Community Growth',
        'Join as Community Ambassador to lead your local chapter.',
        0, 0, true, null, 8),
      ('Open Mentor (Bengaluru)', 'Mentor', 'Bengaluru', 'Technical Guidance',
        'Join as Tech Mentor to support builders in system design and product.',
        0, 0, true, null, 9);
  end if;
end $$;
