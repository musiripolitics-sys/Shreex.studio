-- ============================================================
-- Techxfluence — logical-flow + revenue fixes (consolidated).
-- Run once in the SQL Editor. Idempotent.
-- ============================================================

-- ---------- A5: close the open-insert hole on registrations ----------
-- The atomic RPCs are now the only legitimate write path.
drop policy if exists "anyone register" on public.registrations;

-- ---------- B1: payment idempotency ----------
create unique index if not exists uq_payments_provider_ref
  on public.payments (provider, provider_ref)
  where provider_ref is not null;

-- ---------- A1: host submissions can be paid, with real capacity ----------
alter table public.host_submissions
  add column if not exists price_type   price_type not null default 'Free',
  add column if not exists price_amount int not null default 0,
  add column if not exists capacity     int not null default 100;

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
alter table public.promo_codes enable row level security;
drop policy if exists "admin manage promos" on public.promo_codes;
create policy "admin manage promos" on public.promo_codes
  for all using (public.is_admin()) with check (public.is_admin());

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
grant execute on function public.validate_promo(text) to anon, authenticated;

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
revoke all on function public.redeem_promo(text) from public;
grant execute on function public.redeem_promo(text) to authenticated, service_role;

-- ---------- A2 + B1: registration RPC — reject past events; allow
-- service-role fulfilment (webhook) to attribute the registration ----------
drop function if exists public.register_for_event(uuid, text, text, text, uuid);
create or replace function public.register_for_event(
  p_event_id uuid,
  p_attendee_name text,
  p_attendee_email text,
  p_attendee_phone text default null,
  p_payment_id uuid default null,
  p_user_id uuid default null
)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_event public.events;
  v_ticket text;
  v_uid uuid;
begin
  -- Only the webhook (service role) may attribute a registration to a user.
  v_uid := case when auth.role() = 'service_role'
                then coalesce(auth.uid(), p_user_id)
                else auth.uid() end;

  select * into v_event from public.events where id = p_event_id for update;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  if v_event.status <> 'published' then raise exception 'EVENT_NOT_OPEN'; end if;
  if v_event.date < current_date then raise exception 'EVENT_OVER'; end if;
  if v_event.spots_left <= 0 then raise exception 'EVENT_FULL'; end if;

  insert into public.registrations
    (event_id, user_id, attendee_name, attendee_email, attendee_phone, status, payment_id)
  values
    (p_event_id, v_uid, p_attendee_name, p_attendee_email, p_attendee_phone, 'registered', p_payment_id)
  returning ticket_code into v_ticket;

  update public.events set spots_left = spots_left - 1 where id = p_event_id;
  return v_ticket;
exception
  when unique_violation then raise exception 'ALREADY_REGISTERED';
end; $$;
revoke all on function public.register_for_event(uuid, text, text, text, uuid, uuid) from public;
grant execute on function public.register_for_event(uuid, text, text, text, uuid, uuid)
  to anon, authenticated, service_role;

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

-- ---------- B4: host earnings (ledger) + payouts ----------
create table if not exists public.payouts (
  id         uuid primary key default gen_random_uuid(),
  host_id    uuid not null references public.users(id) on delete cascade,
  amount     int not null,               -- paise
  note       text,
  paid_at    timestamptz not null default now(),
  created_by uuid references public.users(id)
);
alter table public.payouts enable row level security;
drop policy if exists "host read own payouts" on public.payouts;
create policy "host read own payouts" on public.payouts
  for select using (auth.uid() = host_id or public.is_admin());
drop policy if exists "admin manage payouts" on public.payouts;
create policy "admin manage payouts" on public.payouts
  for all using (public.is_admin()) with check (public.is_admin());

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
grant execute on function public.get_host_earnings() to authenticated;

-- ---------- B6: record offline sponsorship revenue (admin) ----------
create or replace function public.record_sponsorship(p_amount int, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  insert into public.payments (user_id, stream, amount, currency, status, provider, provider_ref)
  values (auth.uid(), 'sponsorship', p_amount, 'INR', 'paid', 'manual', null);
end; $$;
grant execute on function public.record_sponsorship(int, text) to authenticated;

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
grant execute on function public.get_top_members(int) to anon, authenticated;
