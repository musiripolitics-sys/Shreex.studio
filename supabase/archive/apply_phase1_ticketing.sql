-- ============================================================
-- Techxfluence — PHASE 1: ticketing foundation.
--   • ticket_types  — multiple tiers per event (Early Bird / VIP …)
--   • orders        — N tickets per purchase (quantity, refunds later)
--   • real datetimes (starts_at / ends_at / timezone)
--   • seat holds so two buyers can't pay for the same last seat
-- Backward compatible: every existing event gets a default
-- "General Admission" tier built from its current price + capacity,
-- and register_for_event() keeps working unchanged.
-- Run once in the SQL Editor. Idempotent.
-- ============================================================

-- ---------- enum ----------
do $$ begin
  create type order_status as enum ('pending','paid','cancelled','refunded');
exception when duplicate_object then null; end $$;

-- ---------- events: real datetimes ----------
alter table public.events
  add column if not exists starts_at timestamptz,
  add column if not exists ends_at   timestamptz,
  add column if not exists timezone  text not null default 'Asia/Kolkata';

update public.events
   set starts_at = (date::timestamp at time zone 'Asia/Kolkata')
 where starts_at is null;

update public.events
   set ends_at = ((coalesce(end_date, date)::timestamp + interval '23 hours') at time zone 'Asia/Kolkata')
 where ends_at is null;

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
create index if not exists idx_ticket_types_event on public.ticket_types (event_id, sort_order);
alter table public.ticket_types enable row level security;

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
  created_at     timestamptz not null default now()
);
create index if not exists idx_orders_user  on public.orders (user_id, created_at desc);
create index if not exists idx_orders_event on public.orders (event_id);
alter table public.orders enable row level security;

drop policy if exists "read own orders" on public.orders;
create policy "read own orders" on public.orders
  for select using (
    auth.uid() = user_id
    or public.is_admin()
    or exists (select 1 from public.events e
               where e.id = orders.event_id and e.host_id = auth.uid())
  );

-- ---------- registrations: link to order + tier, allow multiples ----------
alter table public.registrations
  add column if not exists order_id       uuid references public.orders(id) on delete set null,
  add column if not exists ticket_type_id uuid references public.ticket_types(id) on delete set null;

-- Drop the one-ticket-per-email constraint (it blocks quantity > 1).
-- Free events keep the rule in the RPC instead.
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.registrations'::regclass
     and contype = 'u'
     and pg_get_constraintdef(oid) ilike '%attendee_email%';
  if c is not null then
    execute format('alter table public.registrations drop constraint %I', c);
  end if;
end $$;

-- ---------- backfill: one default tier per existing event ----------
insert into public.ticket_types (event_id, name, price_amount, currency, capacity, sold, sort_order)
select e.id,
       'General Admission',
       e.price_amount,
       e.currency,
       greatest(e.capacity, 0),
       greatest(e.capacity - e.spots_left, 0),
       0
from public.events e
where not exists (select 1 from public.ticket_types t where t.event_id = e.id);

-- Attach existing registrations to their event's default tier.
update public.registrations r
   set ticket_type_id = t.id
  from public.ticket_types t
 where t.event_id = r.event_id and r.ticket_type_id is null;

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
grant execute on function public.member_discount_pct(uuid) to authenticated, service_role;

-- ---------- create_pending_order: prices server-side + holds seats ----------
create or replace function public.create_pending_order(
  p_event_id       uuid,
  p_ticket_type_id uuid,
  p_quantity       int,
  p_buyer_name     text,
  p_buyer_email    text,
  p_buyer_phone    text default null,
  p_promo_code     text default null,
  p_user_id        uuid default null
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

  -- Member and promo don't stack — the better one applies.
  v_best_pct := greatest(v_member_pct, v_promo_pct);
  v_discount := round(v_subtotal * v_best_pct / 100.0);
  v_total    := v_subtotal - v_discount;

  insert into public.orders (
    user_id, event_id, ticket_type_id, quantity,
    buyer_name, buyer_email, buyer_phone,
    subtotal, discount, total, currency, promo_code, status, expires_at
  ) values (
    v_uid, p_event_id, p_ticket_type_id, p_quantity,
    p_buyer_name, p_buyer_email, p_buyer_phone,
    v_subtotal, v_discount, v_total, v_tt.currency,
    nullif(trim(coalesce(p_promo_code, '')), ''),
    'pending', now() + interval '15 minutes'
  ) returning id into v_order_id;

  -- Hold the seats so a second buyer can't take them mid-checkout.
  update public.ticket_types set sold = sold + p_quantity where id = p_ticket_type_id;
  update public.events set spots_left = greatest(spots_left - p_quantity, 0) where id = p_event_id;

  return jsonb_build_object(
    'order_id', v_order_id, 'subtotal', v_subtotal, 'discount', v_discount,
    'total', v_total, 'currency', v_tt.currency, 'discount_pct', v_best_pct
  );
end; $$;
revoke all on function public.create_pending_order(uuid, uuid, int, text, text, text, text, uuid) from public;
grant execute on function public.create_pending_order(uuid, uuid, int, text, text, text, text, uuid)
  to anon, authenticated, service_role;

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
revoke all on function public.fulfil_order(uuid, uuid) from public;
grant execute on function public.fulfil_order(uuid, uuid) to authenticated, service_role;

-- ---------- register_free_order: free path, one transaction ----------
create or replace function public.register_free_order(
  p_event_id uuid, p_ticket_type_id uuid, p_quantity int,
  p_buyer_name text, p_buyer_email text, p_buyer_phone text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_tt public.ticket_types; v_order jsonb;
begin
  select * into v_tt from public.ticket_types
   where id = p_ticket_type_id and event_id = p_event_id;
  if not found then raise exception 'TICKET_TYPE_NOT_FOUND'; end if;
  if v_tt.price_amount > 0 then raise exception 'NOT_FREE'; end if;

  -- Replaces the dropped unique constraint: free events stay one-per-email.
  if exists (
    select 1 from public.registrations r
     where r.event_id = p_event_id
       and r.attendee_email = p_buyer_email
       and r.status in ('registered', 'attended')
  ) then raise exception 'ALREADY_REGISTERED'; end if;

  v_order := public.create_pending_order(
    p_event_id, p_ticket_type_id, p_quantity,
    p_buyer_name, p_buyer_email, p_buyer_phone, null, null
  );
  return public.fulfil_order((v_order->>'order_id')::uuid, null);
end; $$;
revoke all on function public.register_free_order(uuid, uuid, int, text, text, text) from public;
grant execute on function public.register_free_order(uuid, uuid, int, text, text, text)
  to anon, authenticated, service_role;

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
revoke all on function public.expire_pending_orders() from public;
grant execute on function public.expire_pending_orders() to authenticated, service_role;

-- ---------- register_for_event: kept working, now tier-aware ----------
-- Existing app code calls this unchanged; it routes through the default tier.
drop function if exists public.register_for_event(uuid, text, text, text);
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
revoke all on function public.register_for_event(uuid, text, text, text, uuid, uuid) from public;
grant execute on function public.register_for_event(uuid, text, text, text, uuid, uuid)
  to anon, authenticated, service_role;

-- ---------- sanity check ----------
select e.title,
       e.starts_at,
       t.name as tier,
       t.price_amount,
       t.capacity,
       t.sold
from public.events e
join public.ticket_types t on t.event_id = e.id
order by e.starts_at, t.sort_order;
