-- schema.sql part 1 of 6
-- Source lines 1-463 of supabase/schema.sql.
-- Run the parts in order. Each is idempotent, like the whole file.

-- ============================================================
-- Techxfluence — consolidated schema (generated).
-- Rebuilds the whole database from scratch in dependency order.
-- Replaces the incremental apply_*.sql patches; seeds stay separate.
-- ============================================================
create extension if not exists pgcrypto;
create extension if not exists citext;


-- ============================================================
-- Enums
-- ============================================================

do $$ begin
  -- case-insensitive email

-- ---------- Enums ----------
create type user_role           as enum ('community_member','event_attendee','event_host','partner_sponsor','admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type event_category      as enum ('Meetup','Workshop','Webinar','Hackathon','Conference','Networking','Product Launch');
exception when duplicate_object then null; end $$;

do $$ begin
  create type event_status        as enum ('draft','pending_review','approved','published','cancelled','completed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type price_type          as enum ('Free','Paid');
exception when duplicate_object then null; end $$;

do $$ begin
  create type event_source        as enum ('system','custom','host_submission');
exception when duplicate_object then null; end $$;

do $$ begin
  create type submission_status   as enum ('pending','approved','declined');
exception when duplicate_object then null; end $$;

do $$ begin
  create type registration_status as enum ('registered','waitlisted','cancelled','attended','no_show');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_status      as enum ('pending','paid','failed','refunded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type membership_tier     as enum ('Free','Pro','Elite');
exception when duplicate_object then null; end $$;

do $$ begin
  create type membership_status   as enum ('active','cancelled','expired','past_due');
exception when duplicate_object then null; end $$;

do $$ begin
  create type leader_role         as enum ('Founder','Community Lead','Event Coordinator','Ambassador','Mentor');
exception when duplicate_object then null; end $$;

do $$ begin
  create type partner_type        as enum ('Technology Companies','Startups','Communities','Colleges','Media Partners');
exception when duplicate_object then null; end $$;

do $$ begin
  create type contact_topic       as enum ('General enquiry','Host an event','Partnership / Sponsorship','Membership','Press / Media');
exception when duplicate_object then null; end $$;

do $$ begin
  create type revenue_stream      as enum ('membership','ticket_sales','sponsorship','listing_fee','workshop_program');
exception when duplicate_object then null; end $$;

do $$ begin
  create type contact_status      as enum ('new','read','replied','archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type order_status as enum ('pending','paid','cancelled','refunded');
exception when duplicate_object then null; end $$;


-- ============================================================
-- Tables
-- ============================================================

-- ============================================================
-- Identity (mirrors Supabase auth.users)
-- ============================================================
create table if not exists public.users (
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
  updated_at   timestamptz not null default now(),
  host_status text not null default 'none',
  discoverable boolean not null default false
);

create table if not exists public.user_roles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  role       user_role not null,
  granted_at timestamptz not null default now(),
  unique (user_id, role)
);

-- ============================================================
-- Reference / config
-- ============================================================
create table if not exists public.cities (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  state        text,
  is_active    boolean not null default true,
  lead_user_id uuid references public.users(id) on delete set null
);

create table if not exists public.partners (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  type        partner_type,
  logo_url    text,
  website_url text,
  is_active   boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.activities (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  accent      text,
  sort_order  int not null default 0
);

create table if not exists public.speakers (
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
create table if not exists public.payments (
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

-- ============================================================
-- Events
-- ============================================================
create table if not exists public.events (
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
  updated_at    timestamptz not null default now(),
  host_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text not null default 'Asia/Kolkata'
);

create table if not exists public.host_submissions (
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
  submitted_at       timestamptz not null default now(),
  price_type price_type not null default 'Free',
  price_amount int not null default 0,
  capacity int not null default 100
);

create table if not exists public.event_speakers (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  speaker_id uuid not null references public.speakers(id) on delete cascade,
  sort_order int not null default 0,
  unique (event_id, speaker_id)
);

create table if not exists public.event_agenda (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  when_label text not null,
  what       text not null,
  sort_order int not null default 0
);

-- ============================================================
-- Registration & attendance
-- ============================================================
create table if not exists public.registrations (
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
  reminded_at timestamptz
);

-- ============================================================
-- Membership
-- ============================================================
create table if not exists public.membership_plans (
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

create table if not exists public.benefits (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  icon        text,
  tag         text,
  sort_order  int not null default 0
);

create table if not exists public.plan_benefits (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references public.membership_plans(id) on delete cascade,
  benefit_id uuid references public.benefits(id) on delete cascade,
  perk_text  text,
  unique (plan_id, benefit_id)
);

create table if not exists public.memberships (
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

-- ============================================================
-- Leadership & gamification
-- ============================================================
create table if not exists public.leader_profiles (
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

create table if not exists public.badges (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  icon        text,
  criteria    text
);

create table if not exists public.user_badges (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  badge_id   uuid not null references public.badges(id) on delete cascade,
  awarded_at timestamptz not null default now(),
  unique (user_id, badge_id)
);

create table if not exists public.point_events (
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
create table if not exists public.sponsorships (
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
create table if not exists public.newsletter_subscribers (
  id              uuid primary key default gen_random_uuid(),
  email           citext not null unique,
  source          text,
  is_confirmed    boolean not null default false,
  confirmed_at    timestamptz,
  unsubscribed_at timestamptz,
  created_at      timestamptz not null default now()
);

create table if not exists public.contact_messages (
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
-- Techxfluence — community feed (members-only posts). Run once. Idempotent.
-- author_name/role are denormalised so the feed never has to read the
-- private users table.
-- ============================================================
create table if not exists public.posts (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null references public.users(id) on delete cascade,
  author_name text not null,
  author_role text,
  body        text not null,
  pinned      boolean not null default false,
  created_at  timestamptz not null default now(),
  channel text not null default 'all',
  event_id uuid references public.events(id) on delete cascade
);

-- ============================================================
-- Techxfluence — likes + comments for the community feed. Run once. Idempotent.
-- ============================================================

-- ---------- Likes (one per user per post) ----------
create table if not exists public.post_reactions (
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- ---------- Comments ----------
create table if not exists public.post_comments (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.posts(id) on delete cascade,
  author_id   uuid not null references public.users(id) on delete cascade,
  author_name text not null,
  body        text not null,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- Techxfluence — in-app notifications. Run once. Idempotent.
-- ============================================================
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  type       text not null default 'info',
  title      text not null,
  body       text,
  link       text,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- B5: promo codes ----------
create table if not exists public.promo_codes (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  percent_off int  not null check (percent_off between 1 and 90),
  active      boolean not null default true,
  expires_at  timestamptz,
  max_uses    int,
  uses        int not null default 0,
  created_at  timestamptz not null default now()
);

-- ---------- B4: host earnings (ledger) + payouts ----------
create table if not exists public.payouts (
  id         uuid primary key default gen_random_uuid(),
  host_id    uuid not null references public.users(id) on delete cascade,
  amount     int not null,               -- paise
  note       text,
  paid_at    timestamptz not null default now(),
  created_by uuid references public.users(id)
);
