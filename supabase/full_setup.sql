-- ============================================================
-- Techxfluence — FULL DATABASE SETUP (schema + seed)
-- Run once on a fresh Supabase project: SQL Editor → paste → Run.
-- ============================================================

-- ---------- Extensions ----------
create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists citext;     -- case-insensitive email

-- ---------- Enums ----------
create type user_role           as enum ('community_member','event_attendee','event_host','partner_sponsor','admin');
create type event_category      as enum ('Meetup','Workshop','Webinar','Hackathon','Conference','Networking','Product Launch');
create type event_status        as enum ('draft','pending_review','approved','published','cancelled','completed');
create type price_type          as enum ('Free','Paid');
create type event_source        as enum ('system','custom','host_submission');
create type submission_status   as enum ('pending','approved','declined');
create type registration_status as enum ('registered','waitlisted','cancelled','attended','no_show');
create type payment_status      as enum ('pending','paid','failed','refunded');
create type membership_tier     as enum ('Free','Pro','Elite');
create type membership_status   as enum ('active','cancelled','expired','past_due');
create type leader_role         as enum ('Founder','Community Lead','Event Coordinator','Ambassador','Mentor');
create type partner_type        as enum ('Technology Companies','Startups','Communities','Colleges','Media Partners');
create type contact_topic       as enum ('General enquiry','Host an event','Partnership / Sponsorship','Membership','Press / Media');
create type revenue_stream      as enum ('membership','ticket_sales','sponsorship','listing_fee','workshop_program');
create type contact_status      as enum ('new','read','replied','archived');

-- ---------- updated_at helper ----------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

-- ============================================================
-- Identity (mirrors Supabase auth.users)
-- ============================================================
create table public.users (
  id           uuid primary key references auth.users(id) on delete cascade,
  full_name    text,
  email        citext unique,
  phone        text,
  avatar_url   text,
  city         text,
  bio          text,
  linkedin_url text,
  primary_role user_role not null default 'community_member',
  points       int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger trg_users_updated before update on public.users
  for each row execute function set_updated_at();

create table public.user_roles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  role       user_role not null,
  granted_at timestamptz not null default now(),
  unique (user_id, role)
);

create or replace function public.is_admin()
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = 'admin'
  );
$$;

-- ============================================================
-- Reference / config
-- ============================================================
create table public.cities (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  state        text,
  is_active    boolean not null default true,
  lead_user_id uuid references public.users(id) on delete set null
);

create table public.partners (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  type        partner_type,
  logo_url    text,
  website_url text,
  is_active   boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create table public.activities (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  accent      text,
  sort_order  int not null default 0
);

create table public.speakers (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  role         text,
  initials     varchar(4),
  photo_url    text,
  linkedin_url text,
  created_at   timestamptz not null default now()
);

-- ============================================================
-- Payments (before events / registrations / sponsorships)
-- ============================================================
create table public.payments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references public.users(id) on delete set null,
  stream       revenue_stream not null,
  amount       int not null,                 -- minor units (paise)
  currency     char(3) not null default 'INR',
  status       payment_status not null default 'pending',
  provider     text,
  provider_ref text,
  related_type text,
  related_id   uuid,
  created_at   timestamptz not null default now()
);
create index on public.payments (user_id);
create index on public.payments (related_type, related_id);

-- ============================================================
-- Events
-- ============================================================
create table public.events (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  title         text not null,
  category      event_category not null,
  date          date not null,
  end_date      date,
  date_label    text,
  time          text,
  city          text not null,
  venue         text not null,
  address       text,
  price_type    price_type not null default 'Free',
  price_label   text default 'Free',
  price_amount  int not null default 0,
  currency      char(3) not null default 'INR',
  blurb         text,
  about         text,
  capacity      int not null default 0,
  spots_left    int not null default 0,
  image_url     text,
  status        event_status not null default 'draft',
  source        event_source not null default 'custom',
  host_id       uuid references public.users(id) on delete set null,
  submission_id uuid,
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_events_updated before update on public.events
  for each row execute function set_updated_at();
create index on public.events (status);
create index on public.events (category);
create index on public.events (date);

create table public.host_submissions (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null,
  category           event_category not null,
  date               date not null,
  city               text not null,
  venue              text not null,
  organizer_email    citext not null,
  organizer_id       uuid references public.users(id) on delete set null,
  description        text not null,
  status             submission_status not null default 'pending',
  reviewed_by        uuid references public.users(id) on delete set null,
  reviewed_at        timestamptz,
  published_event_id uuid references public.events(id) on delete set null,
  submitted_at       timestamptz not null default now()
);
create index on public.host_submissions (status);

alter table public.events
  add constraint events_submission_fk
  foreign key (submission_id) references public.host_submissions(id) on delete set null;

create table public.event_speakers (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  speaker_id uuid not null references public.speakers(id) on delete cascade,
  sort_order int not null default 0,
  unique (event_id, speaker_id)
);

create table public.event_agenda (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  when_label text not null,
  what       text not null,
  sort_order int not null default 0
);

-- ============================================================
-- Registration & attendance
-- ============================================================
create table public.registrations (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references public.events(id) on delete cascade,
  user_id        uuid references public.users(id) on delete set null,
  attendee_name  text not null,
  attendee_email citext not null,
  attendee_phone text,
  status         registration_status not null default 'registered',
  ticket_code    text unique default encode(gen_random_bytes(6),'hex'),
  checked_in_at  timestamptz,
  payment_id     uuid references public.payments(id) on delete set null,
  registered_at  timestamptz not null default now(),
  unique (event_id, attendee_email)
);
create index on public.registrations (event_id);
create index on public.registrations (user_id);

-- ============================================================
-- Membership
-- ============================================================
create table public.membership_plans (
  id           uuid primary key default gen_random_uuid(),
  tier         membership_tier not null unique,
  name         text not null,
  price_amount int not null default 0,
  currency     char(3) not null default 'INR',
  cadence      text,
  tagline      text,
  is_highlight boolean not null default false,
  cta_label    text,
  sort_order   int not null default 0
);

create table public.benefits (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  icon        text,
  tag         text,
  sort_order  int not null default 0
);

create table public.plan_benefits (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references public.membership_plans(id) on delete cascade,
  benefit_id uuid references public.benefits(id) on delete cascade,
  perk_text  text,
  unique (plan_id, benefit_id)
);

create table public.memberships (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.users(id) on delete cascade,
  plan_id              uuid references public.membership_plans(id) on delete set null,
  tier                 membership_tier not null,
  status               membership_status not null default 'active',
  started_at           timestamptz not null default now(),
  renews_at            timestamptz,
  cancelled_at         timestamptz,
  payment_provider_ref text
);
create index on public.memberships (user_id);

-- ============================================================
-- Leadership & gamification
-- ============================================================
create table public.leader_profiles (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references public.users(id) on delete set null,
  display_name text not null,
  role         leader_role not null,
  city         text,
  focus        text,
  bio          text,
  events_count int not null default 0,
  points       int not null default 0,
  linkedin_url text,
  is_hiring    boolean not null default false,
  image_url    text,
  sort_order   int not null default 0
);

create table public.badges (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  icon        text,
  criteria    text
);

create table public.user_badges (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  badge_id   uuid not null references public.badges(id) on delete cascade,
  awarded_at timestamptz not null default now(),
  unique (user_id, badge_id)
);

create table public.point_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  delta      int not null,
  reason     text,
  event_id   uuid references public.events(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Sponsorships
-- ============================================================
create table public.sponsorships (
  id         uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete cascade,
  event_id   uuid references public.events(id) on delete set null,
  tier       text,
  amount     int,
  currency   char(3) not null default 'INR',
  starts_at  timestamptz,
  ends_at    timestamptz,
  payment_id uuid references public.payments(id) on delete set null
);

-- ============================================================
-- Marketing & comms
-- ============================================================
create table public.newsletter_subscribers (
  id              uuid primary key default gen_random_uuid(),
  email           citext not null unique,
  source          text,
  is_confirmed    boolean not null default false,
  confirmed_at    timestamptz,
  unsubscribed_at timestamptz,
  created_at      timestamptz not null default now()
);

create table public.contact_messages (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  email      citext not null,
  topic      contact_topic not null,
  message    text not null,
  status     contact_status not null default 'new',
  handled_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Auto-create profile on signup
-- ============================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  free_plan_id uuid;
begin
  insert into public.users (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;

  select id into free_plan_id from public.membership_plans where tier = 'Free';

  if free_plan_id is not null then
    insert into public.memberships (user_id, plan_id, tier, status)
    values (new.id, free_plan_id, 'Free', 'active')
    on conflict do nothing;
  end if;

  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- Row Level Security (starter policies — review before prod)
-- ============================================================
alter table public.users                 enable row level security;
alter table public.user_roles             enable row level security;
alter table public.cities                 enable row level security;
alter table public.partners               enable row level security;
alter table public.activities             enable row level security;
alter table public.speakers               enable row level security;
alter table public.payments               enable row level security;
alter table public.events                 enable row level security;
alter table public.host_submissions       enable row level security;
alter table public.event_speakers         enable row level security;
alter table public.event_agenda           enable row level security;
alter table public.registrations          enable row level security;
alter table public.membership_plans       enable row level security;
alter table public.benefits               enable row level security;
alter table public.plan_benefits          enable row level security;
alter table public.memberships            enable row level security;
alter table public.leader_profiles        enable row level security;
alter table public.badges                 enable row level security;
alter table public.user_badges            enable row level security;
alter table public.point_events           enable row level security;
alter table public.sponsorships           enable row level security;
alter table public.newsletter_subscribers enable row level security;
alter table public.contact_messages       enable row level security;

create policy "public read published events" on public.events
  for select using (status = 'published' or public.is_admin());
create policy "public read speakers"       on public.speakers         for select using (true);
create policy "public read event_speakers" on public.event_speakers   for select using (true);
create policy "public read event_agenda"   on public.event_agenda     for select using (true);
create policy "public read plans"          on public.membership_plans for select using (true);
create policy "public read benefits"       on public.benefits         for select using (true);
create policy "public read plan_benefits"  on public.plan_benefits    for select using (true);
create policy "public read leaders"        on public.leader_profiles  for select using (true);
create policy "public read partners"       on public.partners         for select using (is_active or public.is_admin());
create policy "public read activities"     on public.activities       for select using (true);
create policy "public read cities"         on public.cities           for select using (true);
create policy "public read badges"         on public.badges           for select using (true);

create policy "anyone submit host proposal" on public.host_submissions      for insert with check (true);
create policy "anyone submit contact"       on public.contact_messages      for insert with check (true);
create policy "anyone subscribe newsletter" on public.newsletter_subscribers for insert with check (true);
create policy "anyone register"             on public.registrations         for insert with check (true);

create policy "read own profile"   on public.users for select using (auth.uid() = id or public.is_admin());
create policy "update own profile" on public.users for update using (auth.uid() = id);

create policy "own registrations" on public.registrations for select using (auth.uid() = user_id or public.is_admin());
create policy "own memberships"   on public.memberships   for select using (auth.uid() = user_id or public.is_admin());
create policy "own user_badges"   on public.user_badges   for select using (auth.uid() = user_id or public.is_admin());
create policy "own point_events"  on public.point_events  for select using (auth.uid() = user_id or public.is_admin());

create policy "admin manage events"         on public.events            for all using (public.is_admin()) with check (public.is_admin());
create policy "admin manage submissions"    on public.host_submissions  for all using (public.is_admin()) with check (public.is_admin());
create policy "admin manage partners"       on public.partners          for all using (public.is_admin()) with check (public.is_admin());
create policy "admin manage speakers"       on public.speakers          for all using (public.is_admin()) with check (public.is_admin());
create policy "admin manage event_speakers" on public.event_speakers    for all using (public.is_admin()) with check (public.is_admin());
create policy "admin manage event_agenda"   on public.event_agenda      for all using (public.is_admin()) with check (public.is_admin());
create policy "admin manage plans"          on public.membership_plans  for all using (public.is_admin()) with check (public.is_admin());
create policy "admin manage benefits"       on public.benefits          for all using (public.is_admin()) with check (public.is_admin());
create policy "admin manage leaders"        on public.leader_profiles   for all using (public.is_admin()) with check (public.is_admin());
create policy "admin manage contact"        on public.contact_messages  for all using (public.is_admin()) with check (public.is_admin());
create policy "admin manage newsletter"     on public.newsletter_subscribers for all using (public.is_admin()) with check (public.is_admin());
create policy "admin manage registrations"  on public.registrations     for all using (public.is_admin()) with check (public.is_admin());
create policy "admin manage payments"       on public.payments          for all using (public.is_admin()) with check (public.is_admin());
create policy "admin manage sponsorships"   on public.sponsorships      for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- SEED — static config from src/lib/data.ts
-- ============================================================
insert into public.membership_plans (tier, name, price_amount, cadence, tagline, is_highlight, cta_label, sort_order) values
  ('Free',  'Free Member',  0,      'forever',   'Get plugged into the community.',  false, 'Join Free',    1),
  ('Pro',   'Pro Member',   49900,  'per month', 'For builders who show up.',        true,  'Go Pro',       2),
  ('Elite', 'Elite Member', 149900, 'per month', 'Lead, mentor and get recognised.', false, 'Become Elite', 3)
on conflict (tier) do update set
  name = excluded.name, price_amount = excluded.price_amount, cadence = excluded.cadence,
  tagline = excluded.tagline, is_highlight = excluded.is_highlight, cta_label = excluded.cta_label;

delete from public.plan_benefits;
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

insert into public.activities (title, description, accent, sort_order) values
  ('Monthly Meetups','Recurring city meetups across 20+ cities.','brand',1),
  ('Hackathons','Weekend build sprints with real prizes.','join',2),
  ('Workshops','Hands-on, expert-led skill sessions.','host',3),
  ('Startup Showcases','A stage for early teams to launch.','brand',4),
  ('Mentorship','1:1 guidance from senior operators.','join',5),
  ('Innovation Challenges','Monthly contests & open-source bounties.','host',6)
on conflict do nothing;

insert into public.partners (name, type, sort_order) values
  ('NimbusCloud','Technology Companies',1),('ForgeAI','Technology Companies',2),
  ('StackHaus','Technology Companies',3),('Quantyx','Startups',4),
  ('ByteBazaar','Startups',5),('Hexolabs','Startups',6),
  ('Vega Ventures','Communities',7),('CampusOrbit','Colleges',8),
  ('DevMint','Technology Companies',9),('PixelForge','Startups',10),
  ('OpenLoop','Communities',11),('Nexa Media','Media Partners',12)
on conflict do nothing;
