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
create index if not exists idx_event_questions on public.event_questions (event_id, sort_order);
alter table public.event_questions enable row level security;

-- Anyone who can see the event can see its questions (the form needs them).
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

-- Answers ride along on the order.
alter table public.orders add column if not exists answers jsonb;

-- IMPORTANT: adding a parameter creates a SECOND overload, and PostgREST
-- refuses to choose between them (PGRST203) — which breaks registration.
-- Drop the previous signatures before recreating.
drop function if exists public.create_pending_order(uuid, uuid, int, text, text, text, text, uuid);
drop function if exists public.register_free_order(uuid, uuid, int, text, text, text);

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
revoke all on function public.create_pending_order(uuid, uuid, int, text, text, text, text, uuid, jsonb) from public;
grant execute on function public.create_pending_order(uuid, uuid, int, text, text, text, text, uuid, jsonb)
  to anon, authenticated, service_role;

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
revoke all on function public.register_free_order(uuid, uuid, int, text, text, text, jsonb) from public;
grant execute on function public.register_free_order(uuid, uuid, int, text, text, text, jsonb)
  to anon, authenticated, service_role;
