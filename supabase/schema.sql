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

-- ---------- ticket_types ----------
create table if not exists public.ticket_types (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events(id) on delete cascade,
  name          text not null,
  description   text,
  price_amount  int  not null default 0,          -- paise (0 = free tier)
  currency      char(3) not null default 'INR',
  capacity      int  not null default 0,
  sold          int  not null default 0,
  sales_start   timestamptz,
  sales_end     timestamptz,
  min_per_order int  not null default 1,
  max_per_order int  not null default 10,
  is_hidden     boolean not null default false,
  sort_order    int  not null default 0,
  created_at    timestamptz not null default now()
);

-- ---------- orders ----------
create table if not exists public.orders (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references public.users(id) on delete set null,
  event_id       uuid not null references public.events(id) on delete cascade,
  ticket_type_id uuid references public.ticket_types(id) on delete set null,
  quantity       int  not null default 1,
  buyer_name     text not null,
  buyer_email    citext not null,
  buyer_phone    text,
  subtotal       int  not null default 0,
  discount       int  not null default 0,
  total          int  not null default 0,
  currency       char(3) not null default 'INR',
  promo_code     text,
  status         order_status not null default 'pending',
  payment_id     uuid references public.payments(id) on delete set null,
  expires_at     timestamptz,
  created_at     timestamptz not null default now(),
  answers jsonb
);

-- ============================================================
-- Techxfluence — custom registration questions per event.
-- Answers are stored as JSONB on the order (one set per purchase),
-- which avoids a join table and keeps the checkout RPC a single write.
-- Run once. Idempotent.
-- ============================================================

create table if not exists public.event_questions (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  label      text not null,
  type       text not null default 'text',   -- text | textarea | select
  options    text[],                         -- choices when type = 'select'
  required   boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Techxfluence — save / wishlist events.
-- A member bookmarks events they're interested in but not ready
-- to register for. Purely per-user: nobody sees anyone else's list.
-- Run once. Idempotent.
-- ============================================================
create table if not exists public.saved_events (
  user_id    uuid not null references public.users(id) on delete cascade,
  event_id   uuid not null references public.events(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

-- ============================================================
-- Techxfluence — public organizer profiles + follow.
-- users is private, so the public profile is served by a
-- SECURITY DEFINER function exposing only safe fields, and only
-- for people who actually host published events.
-- Run once. Idempotent.
-- ============================================================

create table if not exists public.organizer_follows (
  follower_id  uuid not null references public.users(id) on delete cascade,
  organizer_id uuid not null references public.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, organizer_id)
);


-- ============================================================
-- Deferred columns (forward references)
-- ============================================================

alter table public.registrations add column if not exists order_id uuid references public.orders(id) on delete set null;

alter table public.registrations add column if not exists ticket_type_id uuid references public.ticket_types(id) on delete set null;


-- ============================================================
-- Indexes
-- ============================================================

create index on public.payments (user_id);

create index on public.payments (related_type, related_id);

create index on public.events (status);

create index on public.events (category);

create index on public.events (date);

create index on public.host_submissions (status);

create index on public.registrations (event_id);

create index on public.registrations (user_id);

create index on public.memberships (user_id);

-- Helps the cron quickly find un-reminded registrations.
create index if not exists idx_registrations_reminded
  on public.registrations (reminded_at)
  where reminded_at is null;

create index if not exists idx_posts_created on public.posts (created_at desc);

create index if not exists idx_comments_post on public.post_comments (post_id, created_at);

create index if not exists idx_posts_channel on public.posts (channel, created_at desc);

create index if not exists idx_posts_event on public.posts (event_id, created_at desc);

create index if not exists idx_notif_user on public.notifications (user_id, created_at desc);

-- ---------- B1: payment idempotency ----------
create unique index if not exists uq_payments_provider_ref
  on public.payments (provider, provider_ref)
  where provider_ref is not null;

create index if not exists idx_ticket_types_event on public.ticket_types (event_id, sort_order);

create index if not exists idx_orders_user  on public.orders (user_id, created_at desc);

create index if not exists idx_orders_event on public.orders (event_id);

create index if not exists idx_event_questions on public.event_questions (event_id, sort_order);

create index if not exists idx_saved_events_user
  on public.saved_events (user_id, created_at desc);

create index if not exists idx_follows_organizer
  on public.organizer_follows (organizer_id);


-- ============================================================
-- Functions
-- ============================================================

-- ---------- updated_at helper ----------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

-- ---------- Role helper functions ----------
create or replace function public.is_admin()
returns boolean language sql security definer set search_path = public as $$
  select
    exists (select 1 from public.users      where id = auth.uid() and primary_role = 'admin')
    or
    exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin');
$$;

-- ---------- A4: adopt guest registrations when the email signs up ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email, full_name, phone, city, primary_role, host_status)
  values (
    new.id, new.email,
    new.raw_user_meta_data->>'full_name',
    nullif(new.raw_user_meta_data->>'phone', ''),
    nullif(new.raw_user_meta_data->>'city', ''),
    'community_member',
    case when new.raw_user_meta_data->>'role' = 'event_host' then 'pending' else 'none' end
  )
  on conflict (id) do nothing;

  -- Claim any guest registrations made with this email.
  update public.registrations
     set user_id = new.id
   where user_id is null and attendee_email = new.email;

  return new;
end; $$;

create or replace function public.is_host()
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and primary_role in ('event_host', 'admin')
  );
$$;

create or replace function public.register_for_event(
  p_event_id uuid, p_attendee_name text, p_attendee_email text,
  p_attendee_phone text default null, p_payment_id uuid default null,
  p_user_id uuid default null
)
returns text language plpgsql security definer set search_path = public as $$
declare v_tt public.ticket_types; v_order jsonb; v_res jsonb;
begin
  select * into v_tt from public.ticket_types
   where event_id = p_event_id and is_hidden = false
   order by sort_order, price_amount limit 1;
  if not found then raise exception 'TICKET_TYPE_NOT_FOUND'; end if;

  if v_tt.price_amount = 0 and exists (
    select 1 from public.registrations r
     where r.event_id = p_event_id
       and r.attendee_email = p_attendee_email
       and r.status in ('registered', 'attended')
  ) then raise exception 'ALREADY_REGISTERED'; end if;

  v_order := public.create_pending_order(
    p_event_id, v_tt.id, 1,
    p_attendee_name, p_attendee_email, p_attendee_phone, null, p_user_id
  );
  v_res := public.fulfil_order((v_order->>'order_id')::uuid, p_payment_id);
  return (v_res->'tickets'->>0);
end; $$;

-- ============================================================
-- Techxfluence — keep public.users.email in sync after an
-- email change is confirmed in auth.users. Run once. Idempotent.
-- ============================================================
create or replace function public.sync_user_email()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is distinct from old.email then
    update public.users set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

-- ---------- A2: waitlist also rejects past events ----------
create or replace function public.join_waitlist(
  p_event_id uuid, p_attendee_name text, p_attendee_email text, p_attendee_phone text default null
)
returns text language plpgsql security definer set search_path = public as $$
declare v_event public.events; v_ticket text; v_uid uuid := auth.uid();
begin
  select * into v_event from public.events where id = p_event_id;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  if v_event.status <> 'published' then raise exception 'EVENT_NOT_OPEN'; end if;
  if v_event.date < current_date then raise exception 'EVENT_OVER'; end if;

  insert into public.registrations
    (event_id, user_id, attendee_name, attendee_email, attendee_phone, status)
  values (p_event_id, v_uid, p_attendee_name, p_attendee_email, p_attendee_phone, 'waitlisted')
  returning ticket_code into v_ticket;
  return v_ticket;
exception when unique_violation then raise exception 'ALREADY_REGISTERED';
end; $$;

-- ---------- B5: cancellation — free events auto-promote the waitlist;
-- paid events instead alert the first waitlister to BUY the freed seat ----------
create or replace function public.cancel_registration(p_registration_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_reg public.registrations; v_uid uuid := auth.uid();
  v_event public.events;
  v_next public.registrations; v_did_promote boolean := false;
begin
  select * into v_reg from public.registrations where id = p_registration_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_reg.user_id is distinct from v_uid and not public.is_admin()
     and not exists (select 1 from public.events e where e.id = v_reg.event_id and e.host_id = v_uid) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_event from public.events where id = v_reg.event_id for update;

  if v_reg.status = 'registered' then
    select * into v_next from public.registrations
      where event_id = v_reg.event_id and status = 'waitlisted'
      order by registered_at asc limit 1 for update;

    if found and v_event.price_amount = 0 then
      -- Free event: seat transfers to the waitlister automatically.
      update public.registrations set status = 'registered' where id = v_next.id;
      v_did_promote := true;
    else
      -- Paid event (or no waitlist): the seat returns to the pool.
      update public.events set spots_left = spots_left + 1 where id = v_reg.event_id;
      if found and v_event.price_amount > 0 then
        if v_next.user_id is not null then
          perform public.notify(v_next.user_id, 'waitlist',
            'A spot just opened for ' || v_event.title,
            'You''re first in line — grab your ticket before it''s gone.',
            '/events/' || v_event.slug);
        end if;
        delete from public.registrations where id = v_reg.id;
        return jsonb_build_object('ok', true, 'promoted', null,
          'spot_opened', jsonb_build_object(
            'email', v_next.attendee_email, 'name', v_next.attendee_name,
            'event_title', v_event.title, 'slug', v_event.slug));
      end if;
    end if;
  end if;

  delete from public.registrations where id = v_reg.id;

  if v_did_promote then
    if v_next.user_id is not null then
      perform public.notify(v_next.user_id, 'waitlist', 'You''re off the waitlist! 🎉',
        'A spot opened up for ' || v_event.title || ' — you''re confirmed.',
        '/events/' || v_event.slug);
    end if;
    return jsonb_build_object('ok', true, 'promoted', jsonb_build_object(
      'email', v_next.attendee_email, 'name', v_next.attendee_name,
      'ticket', v_next.ticket_code, 'event_title', v_event.title));
  end if;
  return jsonb_build_object('ok', true, 'promoted', null);
end; $$;

-- ---------- Directory: eligible = opted-in AND (>=100 points OR Elite) ----------
create or replace function public.get_directory()
returns table (
  id uuid, full_name text, city text, bio text, linkedin_url text, primary_role text
)
language sql
security definer
set search_path = public
as $$
  select u.id, u.full_name, u.city, u.bio, u.linkedin_url, u.primary_role::text
  from public.users u
  where u.discoverable = true
    and (
      u.points >= 100
      or exists (
        select 1 from public.memberships m
        where m.user_id = u.id and m.tier = 'Elite' and m.status = 'active'
      )
    )
  order by u.full_name;
$$;

-- ============================================================
-- Techxfluence — attendance points + points-gated directory. Idempotent.
--   • +10 points to a member each time they're checked in to a session.
--   • Directory lists opted-in members who have >= 100 points OR are Elite.
-- ============================================================

-- ---------- Check-in RPC (marks attended + awards 10 points) ----------
-- Runs as definer so a host can update the *attendee's* points (their own RLS
-- can't). Authorization (admin or the event's host) is enforced inside.
create or replace function public.check_in_ticket(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_reg   public.registrations;
  v_event public.events;
begin
  select * into v_reg from public.registrations
    where lower(ticket_code) = lower(trim(p_code))
    limit 1;
  if not found then
    return jsonb_build_object('status', 'invalid',
      'message', 'Ticket not found — or not for one of your events.');
  end if;

  select * into v_event from public.events where id = v_reg.event_id;

  -- Only an admin or the event's host may check this ticket in.
  if not (public.is_admin() or v_event.host_id = v_uid) then
    return jsonb_build_object('status', 'invalid',
      'message', 'Ticket not found — or not for one of your events.');
  end if;

  if v_reg.checked_in_at is not null or v_reg.status = 'attended' then
    return jsonb_build_object('status', 'already', 'message', 'Already checked in',
      'attendeeName', v_reg.attendee_name, 'eventTitle', v_event.title,
      'checkedInAt', v_reg.checked_in_at);
  end if;

  update public.registrations
    set status = 'attended', checked_in_at = now()
    where id = v_reg.id;

  -- Award 10 attendance points to the member (guests with no account get none).
  if v_reg.user_id is not null then
    update public.users set points = points + 10 where id = v_reg.user_id;
  end if;

  return jsonb_build_object('status', 'ok', 'message', 'Checked in',
    'attendeeName', v_reg.attendee_name, 'eventTitle', v_event.title);
end;
$$;

-- Did the current user attend (check in to) this event?
create or replace function public.attended(p_event_id uuid)
returns boolean
language sql security definer stable set search_path = public
as $$
  select exists (
    select 1 from public.registrations r
    where r.event_id = p_event_id and r.user_id = auth.uid() and r.status = 'attended'
  );
$$;

-- Internal helper to notify ANY user. Not granted to clients — only callable
-- from other SECURITY DEFINER functions (owned by the same role).
create or replace function public.notify(
  p_user_id uuid, p_type text, p_title text, p_body text default null, p_link text default null
) returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, type, title, body, link)
  values (p_user_id, p_type, p_title, p_body, p_link);
$$;

-- Admin approves/rejects host access (gated) + notifies the user.
create or replace function public.decide_host(p_user_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_approve then
    update public.users set primary_role = 'event_host', host_status = 'approved' where id = p_user_id;
    perform public.notify(p_user_id, 'host', 'You''re now a Host 🎉',
      'Your host access was approved — you can submit and manage events.', '/host/dashboard');
  else
    update public.users set host_status = 'rejected' where id = p_user_id;
    perform public.notify(p_user_id, 'host', 'Host request update',
      'Your host access request wasn''t approved this time.', null);
  end if;
end; $$;

-- Check a code without consuming it (0 = invalid).
create or replace function public.validate_promo(p_code text)
returns int language sql security definer stable set search_path = public as $$
  select coalesce((
    select percent_off from public.promo_codes
    where lower(code) = lower(trim(p_code)) and active
      and (expires_at is null or expires_at > now())
      and (max_uses is null or uses < max_uses)
  ), 0);
$$;

-- Consume a code after successful payment (returns pct actually applied).
create or replace function public.redeem_promo(p_code text)
returns int language plpgsql security definer set search_path = public as $$
declare v_pct int;
begin
  update public.promo_codes
     set uses = uses + 1
   where lower(code) = lower(trim(p_code)) and active
     and (expires_at is null or expires_at > now())
     and (max_uses is null or uses < max_uses)
  returning percent_off into v_pct;
  return coalesce(v_pct, 0);
end; $$;

-- Earnings for the calling host: 90% of ticket revenue on their events,
-- minus what's already been paid out. (10% platform fee.)
create or replace function public.get_host_earnings()
returns jsonb language sql security definer stable set search_path = public as $$
  with gross as (
    select coalesce(sum(p.amount), 0) as amt
    from public.payments p
    join public.events e on e.id = p.related_id and p.related_type = 'events'
    where e.host_id = auth.uid() and p.stream = 'ticket_sales' and p.status = 'paid'
  ),
  paid as (
    select coalesce(sum(amount), 0) as amt from public.payouts where host_id = auth.uid()
  )
  select jsonb_build_object(
    'gross', (select amt from gross),
    'platform_fee', ((select amt from gross) / 10),
    'net', ((select amt from gross) * 9 / 10),
    'paid_out', (select amt from paid),
    'balance', ((select amt from gross) * 9 / 10) - (select amt from paid)
  );
$$;

-- ---------- B6: record offline sponsorship revenue (admin) ----------
create or replace function public.record_sponsorship(p_amount int, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  insert into public.payments (user_id, stream, amount, currency, status, provider, provider_ref)
  values (auth.uid(), 'sponsorship', p_amount, 'INR', 'paid', 'manual', null);
end; $$;

-- ---------- A6: public top-members leaderboard (opt-in members only) ----------
create or replace function public.get_top_members(p_limit int default 10)
returns table (full_name text, city text, points int)
language sql security definer stable set search_path = public as $$
  select u.full_name, u.city, u.points
  from public.users u
  where u.discoverable = true and u.points > 0
  order by u.points desc
  limit least(coalesce(p_limit, 10), 50);
$$;

-- ---------- member discount, in SQL so pricing has one source of truth ----------
create or replace function public.member_discount_pct(p_user_id uuid)
returns int language sql security definer stable set search_path = public as $$
  select coalesce((
    select case when m.tier = 'Elite' then 50
                when m.tier = 'Pro'   then 25
                else 0 end
    from public.memberships m
    where m.user_id = p_user_id
      and m.status = 'active'
      and (m.renews_at is null or m.renews_at > now())
    limit 1
  ), 0);
$$;

-- create_pending_order gains an optional answers payload (appended last so
-- every existing caller keeps working unchanged).
create or replace function public.create_pending_order(
  p_event_id       uuid,
  p_ticket_type_id uuid,
  p_quantity       int,
  p_buyer_name     text,
  p_buyer_email    text,
  p_buyer_phone    text default null,
  p_promo_code     text default null,
  p_user_id        uuid default null,
  p_answers        jsonb default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_event public.events;
  v_tt    public.ticket_types;
  v_uid   uuid;
  v_subtotal int; v_member_pct int := 0; v_promo_pct int := 0; v_best_pct int;
  v_discount int; v_total int; v_order_id uuid;
begin
  v_uid := case when auth.role() = 'service_role'
                then coalesce(auth.uid(), p_user_id)
                else auth.uid() end;

  select * into v_event from public.events where id = p_event_id for update;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  if v_event.status <> 'published' then raise exception 'EVENT_NOT_OPEN'; end if;
  if coalesce(v_event.starts_at, v_event.date::timestamptz) < now() then
    raise exception 'EVENT_OVER';
  end if;

  select * into v_tt from public.ticket_types
   where id = p_ticket_type_id and event_id = p_event_id for update;
  if not found then raise exception 'TICKET_TYPE_NOT_FOUND'; end if;
  if v_tt.sales_start is not null and now() < v_tt.sales_start then raise exception 'SALES_NOT_STARTED'; end if;
  if v_tt.sales_end   is not null and now() > v_tt.sales_end   then raise exception 'SALES_ENDED'; end if;
  if p_quantity < greatest(v_tt.min_per_order, 1) then raise exception 'MIN_QTY'; end if;
  if p_quantity > v_tt.max_per_order then raise exception 'MAX_QTY'; end if;
  if v_tt.capacity - v_tt.sold < p_quantity then raise exception 'NOT_ENOUGH_SEATS'; end if;

  v_subtotal := v_tt.price_amount * p_quantity;

  if v_uid is not null then v_member_pct := public.member_discount_pct(v_uid); end if;
  if p_promo_code is not null and length(trim(p_promo_code)) > 0 then
    v_promo_pct := public.validate_promo(p_promo_code);
    if v_promo_pct <= 0 then raise exception 'INVALID_PROMO'; end if;
  end if;

  v_best_pct := greatest(v_member_pct, v_promo_pct);
  v_discount := round(v_subtotal * v_best_pct / 100.0);
  v_total    := v_subtotal - v_discount;

  insert into public.orders (
    user_id, event_id, ticket_type_id, quantity,
    buyer_name, buyer_email, buyer_phone,
    subtotal, discount, total, currency, promo_code, status, expires_at, answers
  ) values (
    v_uid, p_event_id, p_ticket_type_id, p_quantity,
    p_buyer_name, p_buyer_email, p_buyer_phone,
    v_subtotal, v_discount, v_total, v_tt.currency,
    nullif(trim(coalesce(p_promo_code, '')), ''),
    'pending', now() + interval '15 minutes', p_answers
  ) returning id into v_order_id;

  update public.ticket_types set sold = sold + p_quantity where id = p_ticket_type_id;
  update public.events set spots_left = greatest(spots_left - p_quantity, 0) where id = p_event_id;

  return jsonb_build_object(
    'order_id', v_order_id, 'subtotal', v_subtotal, 'discount', v_discount,
    'total', v_total, 'currency', v_tt.currency, 'discount_pct', v_best_pct
  );
end; $$;

-- ---------- fulfil_order: issue the tickets (idempotent) ----------
create or replace function public.fulfil_order(p_order_id uuid, p_payment_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_o public.orders; v_codes text[] := '{}'; v_code text; i int;
begin
  select * into v_o from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;

  if v_o.status = 'paid' then
    select coalesce(array_agg(ticket_code), '{}') into v_codes
      from public.registrations where order_id = p_order_id;
    return jsonb_build_object('ok', true, 'already', true, 'tickets', to_jsonb(v_codes));
  end if;
  if v_o.status <> 'pending' then raise exception 'ORDER_NOT_PENDING'; end if;

  for i in 1..v_o.quantity loop
    insert into public.registrations (
      event_id, user_id, ticket_type_id, order_id,
      attendee_name, attendee_email, attendee_phone, status, payment_id
    ) values (
      v_o.event_id, v_o.user_id, v_o.ticket_type_id, v_o.id,
      v_o.buyer_name, v_o.buyer_email, v_o.buyer_phone, 'registered', p_payment_id
    ) returning ticket_code into v_code;
    v_codes := array_append(v_codes, v_code);
  end loop;

  update public.orders
     set status = 'paid',
         payment_id = coalesce(p_payment_id, payment_id),
         expires_at = null
   where id = p_order_id;

  if v_o.promo_code is not null then perform public.redeem_promo(v_o.promo_code); end if;

  return jsonb_build_object('ok', true, 'tickets', to_jsonb(v_codes));
end; $$;

-- register_free_order passes answers straight through.
create or replace function public.register_free_order(
  p_event_id uuid, p_ticket_type_id uuid, p_quantity int,
  p_buyer_name text, p_buyer_email text, p_buyer_phone text default null,
  p_answers jsonb default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_tt public.ticket_types; v_order jsonb;
begin
  select * into v_tt from public.ticket_types
   where id = p_ticket_type_id and event_id = p_event_id;
  if not found then raise exception 'TICKET_TYPE_NOT_FOUND'; end if;
  if v_tt.price_amount > 0 then raise exception 'NOT_FREE'; end if;

  if exists (
    select 1 from public.registrations r
     where r.event_id = p_event_id
       and r.attendee_email = p_buyer_email
       and r.status in ('registered', 'attended')
  ) then raise exception 'ALREADY_REGISTERED'; end if;

  v_order := public.create_pending_order(
    p_event_id, p_ticket_type_id, p_quantity,
    p_buyer_name, p_buyer_email, p_buyer_phone, null, null, p_answers
  );
  return public.fulfil_order((v_order->>'order_id')::uuid, null);
end; $$;

-- ---------- expire_pending_orders: release abandoned checkouts ----------
create or replace function public.expire_pending_orders()
returns int language plpgsql security definer set search_path = public as $$
declare v_o record; v_n int := 0;
begin
  for v_o in
    select * from public.orders
     where status = 'pending' and expires_at is not null and expires_at < now()
     for update
  loop
    update public.ticket_types set sold = greatest(sold - v_o.quantity, 0)
      where id = v_o.ticket_type_id;
    update public.events set spots_left = spots_left + v_o.quantity
      where id = v_o.event_id;
    update public.orders set status = 'cancelled' where id = v_o.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end; $$;

-- ============================================================
-- Techxfluence — admin side of host payouts.
--   • get_all_host_earnings() — every host's gross/fee/net/paid/balance
--   • record_payout()         — log a settlement to a host
-- Run once. Idempotent.
-- ============================================================

create or replace function public.get_all_host_earnings()
returns table (
  host_id      uuid,
  host_name    text,
  host_email   text,
  gross        bigint,
  platform_fee bigint,
  net          bigint,
  paid_out     bigint,
  balance      bigint
)
language sql security definer stable set search_path = public as $$
  with gross as (
    select e.host_id, coalesce(sum(p.amount), 0)::bigint as amt
    from public.payments p
    join public.events e on e.id = p.related_id and p.related_type = 'events'
    where p.stream = 'ticket_sales' and p.status = 'paid' and e.host_id is not null
    group by e.host_id
  ),
  paid as (
    select host_id, coalesce(sum(amount), 0)::bigint as amt
    from public.payouts group by host_id
  )
  select u.id,
         u.full_name,
         u.email::text,
         coalesce(g.amt, 0),
         (coalesce(g.amt, 0) / 10),
         (coalesce(g.amt, 0) * 9 / 10),
         coalesce(pd.amt, 0),
         (coalesce(g.amt, 0) * 9 / 10) - coalesce(pd.amt, 0)
  from public.users u
  left join gross g on g.host_id = u.id
  left join paid  pd on pd.host_id = u.id
  where public.is_admin()
    and (g.amt is not null or pd.amt is not null)
  order by ((coalesce(g.amt, 0) * 9 / 10) - coalesce(pd.amt, 0)) desc;
$$;

create or replace function public.record_payout(
  p_host_id uuid, p_amount int, p_note text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;

  insert into public.payouts (host_id, amount, note, created_by)
  values (p_host_id, p_amount, p_note, auth.uid())
  returning id into v_id;

  perform public.notify(
    p_host_id, 'payout', 'Payout sent 💸',
    'A payout of ₹' || (p_amount / 100)::text || ' is on its way to you.',
    '/host/dashboard'
  );
  return v_id;
end; $$;

-- ============================================================
-- Techxfluence — per-event analytics for the organiser.
-- Host-or-admin gated: a host only ever sees their own events.
-- Run once. Idempotent.
-- ============================================================
create or replace function public.get_event_stats(p_event_id uuid)
returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare v_ev public.events;
begin
  select * into v_ev from public.events where id = p_event_id;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  if not (public.is_admin() or v_ev.host_id = auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;

  return jsonb_build_object(
    'revenue', (
      select coalesce(sum(p.amount), 0) from public.payments p
      where p.related_type = 'events' and p.related_id = p_event_id and p.status = 'paid'
    ),
    'tickets', (
      select count(*) from public.registrations r
      where r.event_id = p_event_id and r.status in ('registered', 'attended')
    ),
    'checked_in', (
      select count(*) from public.registrations r
      where r.event_id = p_event_id and r.status = 'attended'
    ),
    'waitlisted', (
      select count(*) from public.registrations r
      where r.event_id = p_event_id and r.status = 'waitlisted'
    ),
    'last7', (
      select count(*) from public.registrations r
      where r.event_id = p_event_id and r.registered_at > now() - interval '7 days'
    ),
    'tiers', (
      select coalesce(
        jsonb_agg(jsonb_build_object(
          'name', t.name, 'sold', t.sold, 'capacity', t.capacity, 'price', t.price_amount
        ) order by t.sort_order), '[]'::jsonb)
      from public.ticket_types t where t.event_id = p_event_id
    )
  );
end; $$;

-- ---------- Public organizer profile (safe fields only) ----------
create or replace function public.get_organizer(p_id uuid)
returns jsonb
language sql security definer stable set search_path = public as $$
  select case when u.id is null then null else jsonb_build_object(
    'id',          u.id,
    'name',        u.full_name,
    'city',        u.city,
    'bio',         u.bio,
    'linkedin',    u.linkedin_url,
    'events_count',(select count(*) from public.events e
                    where e.host_id = u.id and e.status = 'published'),
    'followers',   (select count(*) from public.organizer_follows f
                    where f.organizer_id = u.id)
  ) end
  from public.users u
  where u.id = p_id
    and u.primary_role in ('event_host', 'admin')
    -- Only someone actually running public events gets a public page.
    and exists (select 1 from public.events e
                where e.host_id = u.id and e.status = 'published');
$$;

-- ---------- Notify followers when an organizer publishes ----------
create or replace function public.notify_followers(p_event_id uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare v_ev public.events; v_n int := 0; f record;
begin
  select * into v_ev from public.events where id = p_event_id;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  if not (public.is_admin() or v_ev.host_id = auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;
  if v_ev.status <> 'published' then return 0; end if;

  for f in
    select follower_id from public.organizer_follows
    where organizer_id = v_ev.host_id
  loop
    perform public.notify(
      f.follower_id, 'event',
      'New event from ' || coalesce(v_ev.host_name, 'an organizer you follow'),
      v_ev.title,
      '/events/' || v_ev.slug
    );
    v_n := v_n + 1;
  end loop;
  return v_n;
end; $$;


-- ============================================================
-- Triggers
-- ============================================================

drop trigger if exists trg_users_updated on public.users;
create trigger trg_users_updated before update on public.users
  for each row execute function set_updated_at();

drop trigger if exists trg_events_updated on public.events;
create trigger trg_events_updated before update on public.events
  for each row execute function set_updated_at();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists trg_sync_user_email on auth.users;
create trigger trg_sync_user_email
  after update of email on auth.users
  for each row execute function public.sync_user_email();


-- ============================================================
-- Row level security
-- ============================================================

alter table public.newsletter_subscribers enable row level security;

alter table public.posts enable row level security;

alter table public.post_reactions enable row level security;

alter table public.post_comments enable row level security;

alter table public.notifications enable row level security;

alter table public.promo_codes enable row level security;

alter table public.payouts enable row level security;

alter table public.ticket_types enable row level security;

alter table public.orders enable row level security;

alter table public.event_questions enable row level security;

alter table public.saved_events enable row level security;

alter table public.organizer_follows enable row level security;

drop policy if exists "public read published events" on public.events;
create policy "public read published events" on public.events
  for select using (status = 'published' or public.is_admin());

drop policy if exists "public read speakers" on public.speakers;
create policy "public read speakers"       on public.speakers         for select using (true);

drop policy if exists "public read event_speakers" on public.event_speakers;
create policy "public read event_speakers" on public.event_speakers   for select using (true);

drop policy if exists "public read event_agenda" on public.event_agenda;
create policy "public read event_agenda"   on public.event_agenda     for select using (true);

drop policy if exists "public read plans" on public.membership_plans;
create policy "public read plans"          on public.membership_plans for select using (true);

drop policy if exists "public read benefits" on public.benefits;
create policy "public read benefits"       on public.benefits         for select using (true);

drop policy if exists "public read plan_benefits" on public.plan_benefits;
create policy "public read plan_benefits"  on public.plan_benefits    for select using (true);

drop policy if exists "public read leaders" on public.leader_profiles;
create policy "public read leaders"        on public.leader_profiles  for select using (true);

drop policy if exists "public read partners" on public.partners;
create policy "public read partners"       on public.partners         for select using (is_active or public.is_admin());

drop policy if exists "public read activities" on public.activities;
create policy "public read activities"     on public.activities       for select using (true);

drop policy if exists "public read cities" on public.cities;
create policy "public read cities"         on public.cities           for select using (true);

drop policy if exists "public read badges" on public.badges;
create policy "public read badges"         on public.badges           for select using (true);

drop policy if exists "anyone submit host proposal" on public.host_submissions;
create policy "anyone submit host proposal" on public.host_submissions      for insert with check (true);

drop policy if exists "anyone submit contact" on public.contact_messages;
create policy "anyone submit contact"       on public.contact_messages      for insert with check (true);

drop policy if exists "anyone subscribe newsletter" on public.newsletter_subscribers;
create policy "anyone subscribe newsletter" on public.newsletter_subscribers for insert with check (true);

drop policy if exists "anyone register" on public.registrations;
create policy "anyone register"             on public.registrations         for insert with check (true);

drop policy if exists "read own profile" on public.users;
create policy "read own profile"   on public.users for select using (auth.uid() = id or public.is_admin());

drop policy if exists "update own profile" on public.users;
create policy "update own profile" on public.users for update using (auth.uid() = id);

drop policy if exists "own registrations" on public.registrations;
create policy "own registrations" on public.registrations for select using (auth.uid() = user_id or public.is_admin());

drop policy if exists "own memberships" on public.memberships;
create policy "own memberships"   on public.memberships   for select using (auth.uid() = user_id or public.is_admin());

drop policy if exists "own user_badges" on public.user_badges;
create policy "own user_badges"   on public.user_badges   for select using (auth.uid() = user_id or public.is_admin());

drop policy if exists "own point_events" on public.point_events;
create policy "own point_events"  on public.point_events  for select using (auth.uid() = user_id or public.is_admin());

drop policy if exists "admin manage events" on public.events;
create policy "admin manage events"         on public.events            for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin manage submissions" on public.host_submissions;
create policy "admin manage submissions"    on public.host_submissions  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin manage partners" on public.partners;
create policy "admin manage partners"       on public.partners          for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin manage speakers" on public.speakers;
create policy "admin manage speakers"       on public.speakers          for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin manage event_speakers" on public.event_speakers;
create policy "admin manage event_speakers" on public.event_speakers    for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin manage event_agenda" on public.event_agenda;
create policy "admin manage event_agenda"   on public.event_agenda      for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin manage plans" on public.membership_plans;
create policy "admin manage plans"          on public.membership_plans  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin manage benefits" on public.benefits;
create policy "admin manage benefits"       on public.benefits          for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin manage leaders" on public.leader_profiles;
create policy "admin manage leaders"        on public.leader_profiles   for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin manage contact" on public.contact_messages;
create policy "admin manage contact"        on public.contact_messages  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin manage newsletter" on public.newsletter_subscribers;
create policy "admin manage newsletter"     on public.newsletter_subscribers for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin manage registrations" on public.registrations;
create policy "admin manage registrations"  on public.registrations     for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin manage payments" on public.payments;
create policy "admin manage payments"       on public.payments          for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin manage sponsorships" on public.sponsorships;
create policy "admin manage sponsorships"   on public.sponsorships      for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "read own roles" on public.user_roles;
create policy "read own roles" on public.user_roles
  for select using (auth.uid() = user_id or public.is_admin());

drop policy if exists "admin manage roles" on public.user_roles;
create policy "admin manage roles" on public.user_roles
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin update users" on public.users;
create policy "admin update users" on public.users
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "host read own submissions" on public.host_submissions;
create policy "host read own submissions" on public.host_submissions
  for select using (organizer_id = auth.uid());

drop policy if exists "host resubmit declined" on public.host_submissions;
create policy "host resubmit declined" on public.host_submissions
  for update using (organizer_id = auth.uid() and status = 'declined')
  with check (organizer_id = auth.uid());

drop policy if exists "host read own events" on public.events;
create policy "host read own events" on public.events
  for select using (host_id = auth.uid());

drop policy if exists "host read event registrations" on public.registrations;
create policy "host read event registrations" on public.registrations
  for select using (
    exists (select 1 from public.events e
            where e.id = registrations.event_id and e.host_id = auth.uid())
  );

drop policy if exists "host manage event registrations" on public.registrations;
create policy "host manage event registrations" on public.registrations
  for update using (
    exists (select 1 from public.events e
            where e.id = registrations.event_id and e.host_id = auth.uid())
  );

drop policy if exists "read posts" on public.posts;
create policy "read posts" on public.posts for select using (
  auth.uid() is not null
  and (event_id is null or public.is_admin() or public.attended(event_id))
);

drop policy if exists "create own post" on public.posts;
create policy "create own post" on public.posts for insert with check (
  auth.uid() = author_id
  and (event_id is null or public.is_admin() or public.attended(event_id))
);

drop policy if exists "admin update posts" on public.posts;
create policy "admin update posts" on public.posts
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "delete own or admin" on public.posts;
create policy "delete own or admin" on public.posts
  for delete using (auth.uid() = author_id or public.is_admin());

drop policy if exists "read reactions" on public.post_reactions;
create policy "read reactions" on public.post_reactions for select using (
  exists (
    select 1 from public.posts p
    where p.id = post_reactions.post_id
      and (p.event_id is null or public.is_admin() or public.attended(p.event_id))
  )
);

drop policy if exists "like own" on public.post_reactions;
create policy "like own" on public.post_reactions for insert with check (
  auth.uid() = user_id and exists (
    select 1 from public.posts p
    where p.id = post_reactions.post_id
      and (p.event_id is null or public.is_admin() or public.attended(p.event_id))
  )
);

drop policy if exists "unlike own" on public.post_reactions;
create policy "unlike own" on public.post_reactions
  for delete using (auth.uid() = user_id);

drop policy if exists "read comments" on public.post_comments;
create policy "read comments" on public.post_comments for select using (
  exists (
    select 1 from public.posts p
    where p.id = post_comments.post_id
      and (p.event_id is null or public.is_admin() or public.attended(p.event_id))
  )
);

drop policy if exists "comment own" on public.post_comments;
create policy "comment own" on public.post_comments for insert with check (
  auth.uid() = author_id and exists (
    select 1 from public.posts p
    where p.id = post_comments.post_id
      and (p.event_id is null or public.is_admin() or public.attended(p.event_id))
  )
);

drop policy if exists "delete own comment or admin" on public.post_comments;
create policy "delete own comment or admin" on public.post_comments
  for delete using (auth.uid() = author_id or public.is_admin());

drop policy if exists "read own notifications" on public.notifications;
create policy "read own notifications" on public.notifications
  for select using (auth.uid() = user_id);

drop policy if exists "update own notifications" on public.notifications;
create policy "update own notifications" on public.notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "insert own notifications" on public.notifications;
create policy "insert own notifications" on public.notifications
  for insert with check (auth.uid() = user_id);

drop policy if exists "admin manage promos" on public.promo_codes;
create policy "admin manage promos" on public.promo_codes
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "host read own payouts" on public.payouts;
create policy "host read own payouts" on public.payouts
  for select using (auth.uid() = host_id or public.is_admin());

drop policy if exists "admin manage payouts" on public.payouts;
create policy "admin manage payouts" on public.payouts
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "read ticket types" on public.ticket_types;
create policy "read ticket types" on public.ticket_types
  for select using (
    is_hidden = false
    and exists (select 1 from public.events e
                where e.id = ticket_types.event_id and e.status = 'published')
  );

drop policy if exists "admin manage ticket types" on public.ticket_types;
create policy "admin manage ticket types" on public.ticket_types
  for all using (
    public.is_admin()
    or exists (select 1 from public.events e
               where e.id = ticket_types.event_id and e.host_id = auth.uid())
  ) with check (
    public.is_admin()
    or exists (select 1 from public.events e
               where e.id = ticket_types.event_id and e.host_id = auth.uid())
  );

drop policy if exists "read own orders" on public.orders;
create policy "read own orders" on public.orders
  for select using (
    auth.uid() = user_id
    or public.is_admin()
    or exists (select 1 from public.events e
               where e.id = orders.event_id and e.host_id = auth.uid())
  );

drop policy if exists "host update own events" on public.events;
create policy "host update own events" on public.events
  for update
  using (host_id = auth.uid())
  with check (host_id = auth.uid());

drop policy if exists "read event questions" on public.event_questions;
create policy "read event questions" on public.event_questions
  for select using (
    exists (select 1 from public.events e
            where e.id = event_questions.event_id and e.status = 'published')
  );

drop policy if exists "manage event questions" on public.event_questions;
create policy "manage event questions" on public.event_questions
  for all using (
    public.is_admin()
    or exists (select 1 from public.events e
               where e.id = event_questions.event_id and e.host_id = auth.uid())
  ) with check (
    public.is_admin()
    or exists (select 1 from public.events e
               where e.id = event_questions.event_id and e.host_id = auth.uid())
  );

drop policy if exists "host create own events" on public.events;
create policy "host create own events" on public.events
  for insert
  with check (host_id = auth.uid() and public.is_host());

drop policy if exists "host delete own events" on public.events;
create policy "host delete own events" on public.events
  for delete
  using (host_id = auth.uid());

drop policy if exists "read own saved" on public.saved_events;
create policy "read own saved" on public.saved_events
  for select using (auth.uid() = user_id);

drop policy if exists "save own" on public.saved_events;
create policy "save own" on public.saved_events
  for insert with check (auth.uid() = user_id);

drop policy if exists "unsave own" on public.saved_events;
create policy "unsave own" on public.saved_events
  for delete using (auth.uid() = user_id);

drop policy if exists "read own follows" on public.organizer_follows;
create policy "read own follows" on public.organizer_follows
  for select using (auth.uid() = follower_id or auth.uid() = organizer_id);

drop policy if exists "follow own" on public.organizer_follows;
create policy "follow own" on public.organizer_follows
  for insert with check (auth.uid() = follower_id);

drop policy if exists "unfollow own" on public.organizer_follows;
create policy "unfollow own" on public.organizer_follows
  for delete using (auth.uid() = follower_id);


-- ============================================================
-- Grants
-- ============================================================

revoke all on function public.register_for_event(uuid, text, text, text, uuid, uuid) from public;

grant execute on function public.register_for_event(uuid, text, text, text, uuid, uuid)
  to anon, authenticated, service_role;

revoke all on function public.join_waitlist(uuid, text, text, text) from public;

grant execute on function public.join_waitlist(uuid, text, text, text) to anon, authenticated;

revoke all on function public.cancel_registration(uuid) from public;

grant execute on function public.cancel_registration(uuid) to authenticated;

revoke all on function public.get_directory() from public;

grant execute on function public.get_directory() to authenticated;

revoke all on function public.check_in_ticket(text) from public;

grant execute on function public.check_in_ticket(text) to authenticated;

grant execute on function public.attended(uuid) to authenticated;

revoke all on function public.notify(uuid, text, text, text, text) from public;

revoke all on function public.decide_host(uuid, boolean) from public;

grant execute on function public.decide_host(uuid, boolean) to authenticated;

grant execute on function public.validate_promo(text) to anon, authenticated;

revoke all on function public.redeem_promo(text) from public;

grant execute on function public.redeem_promo(text) to authenticated, service_role;

grant execute on function public.get_host_earnings() to authenticated;

grant execute on function public.record_sponsorship(int, text) to authenticated;

grant execute on function public.get_top_members(int) to anon, authenticated;

grant execute on function public.member_discount_pct(uuid) to authenticated, service_role;

revoke all on function public.create_pending_order(uuid, uuid, int, text, text, text, text, uuid, jsonb) from public;

grant execute on function public.create_pending_order(uuid, uuid, int, text, text, text, text, uuid, jsonb)
  to anon, authenticated, service_role;

revoke all on function public.fulfil_order(uuid, uuid) from public;

grant execute on function public.fulfil_order(uuid, uuid) to authenticated, service_role;

revoke all on function public.register_free_order(uuid, uuid, int, text, text, text, jsonb) from public;

grant execute on function public.register_free_order(uuid, uuid, int, text, text, text, jsonb)
  to anon, authenticated, service_role;

revoke all on function public.expire_pending_orders() from public;

grant execute on function public.expire_pending_orders() to authenticated, service_role;

revoke all on function public.get_all_host_earnings() from public;

grant execute on function public.get_all_host_earnings() to authenticated;

revoke all on function public.record_payout(uuid, int, text) from public;

grant execute on function public.record_payout(uuid, int, text) to authenticated;

revoke all on function public.get_event_stats(uuid) from public;

grant execute on function public.get_event_stats(uuid) to authenticated;

grant execute on function public.get_organizer(uuid) to anon, authenticated;

revoke all on function public.notify_followers(uuid) from public;

grant execute on function public.notify_followers(uuid) to authenticated;
