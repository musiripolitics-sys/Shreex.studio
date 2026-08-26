-- schema.sql part 2 of 6
-- Source lines 464-956 of supabase/schema.sql.
-- Run the parts in order. Each is idempotent, like the whole file.

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

  -- Award 10 attendance credits (guests with no account get none). Routed
  -- through award_credits so the ledger records why the balance moved.
  if v_reg.user_id is not null then
    perform public.award_credits(
      v_reg.user_id, 10, 'Attended ' || coalesce(v_event.title, 'an event'), v_reg.event_id);
    perform public.refresh_badges(v_reg.user_id);
  end if;

  -- Make sure the group has something in it before anyone arrives.
  perform public.ensure_group_seed_post(v_reg.event_id);

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
