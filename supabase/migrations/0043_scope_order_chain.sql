-- ============================================================
-- Stage 5, fifth batch: the ticket and order chain.
--
-- Six functions that call each other, so they are done as one piece:
-- create_pending_order, fulfil_order, register_for_event,
-- register_free_order, cancel_registration, check_in_ticket.
--
-- ============================================================
-- A SECURITY FIX THAT IS NOT ABOUT TENANCY
--
-- fulfil_order is executable by anon -- verified against production, where an
-- unauthenticated call returned ORDER_NOT_FOUND, meaning the function ran --
-- and it never checked the payment. p_payment_id was accepted and ignored. So
-- the sequence
--
--   create_pending_order(...)  -> order_id, seats held
--   fulfil_order(order_id, null) -> tickets issued, order marked paid
--
-- produced free tickets for any paid event. This migration adds the check
-- that was missing: a paid order needs a paid payment row of at least its
-- total, in its own tenant, unless the caller is the service role.
--
-- That raises the bar without closing the door. public.payments still lets a
-- signed-in person insert their own row with status paid -- the policy is
-- auth.uid() = user_id -- so a determined caller can still forge one. Closing
-- it properly means either revoking execute on fulfil_order from anon and
-- authenticated, which requires the ticket-verify route to switch to the
-- service-role client first, or tightening the payments insert policy so a
-- client cannot claim status paid. Both change the purchase flow, so neither
-- is done here unasked.
-- ============================================================
--
-- On deriving the tenant: these functions are called from three places with
-- three different identities -- the public site as anon, the ticket routes as
-- the signed-in user, and the Razorpay webhook as the service role. The
-- service role has no membership, so bos_request_tenant would hand it the
-- default tenant and a second business orders would be fulfilled against the
-- wrong one. Where a row already carries a tenant, these functions take it
-- from the ROW and let the service role act on any of them, scoping to
-- bos_request_tenant for everyone else. create_pending_order already drew
-- that distinction with auth.role() = 'service_role', so the pattern is the
-- codebase own.
--
-- Idempotent. Run AFTER 0042.
-- ============================================================

create or replace function public.create_pending_order(
  p_event_id uuid, p_ticket_type_id uuid, p_quantity integer,
  p_buyer_name text, p_buyer_email text, p_buyer_phone text default null::text,
  p_promo_code text default null::text, p_user_id uuid default null::uuid,
  p_answers jsonb default null::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_event public.events;
  v_tt    public.ticket_types;
  v_uid   uuid;
  v_tenant uuid := public.bos_request_tenant();
  v_subtotal int; v_member_pct int := 0; v_promo_pct int := 0; v_best_pct int;
  v_discount int; v_total int; v_order_id uuid;
begin
  v_uid := case when auth.role() = 'service_role'
                then coalesce(auth.uid(), p_user_id)
                else auth.uid() end;

  select * into v_event from public.events
   where id = p_event_id and tenant_id = v_tenant for update;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  if v_event.status <> 'published' then raise exception 'EVENT_NOT_OPEN'; end if;
  if coalesce(v_event.starts_at, v_event.date::timestamptz) < now() then
    raise exception 'EVENT_OVER';
  end if;

  select * into v_tt from public.ticket_types
   where id = p_ticket_type_id and event_id = p_event_id
     and tenant_id = v_tenant for update;
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
    subtotal, discount, total, currency, promo_code, status, expires_at, answers,
    tenant_id
  ) values (
    v_uid, p_event_id, p_ticket_type_id, p_quantity,
    p_buyer_name, p_buyer_email, p_buyer_phone,
    v_subtotal, v_discount, v_total, v_tt.currency,
    nullif(trim(coalesce(p_promo_code, '')), ''),
    'pending', now() + interval '15 minutes', p_answers,
    v_tenant
  ) returning id into v_order_id;

  update public.ticket_types set sold = sold + p_quantity
   where id = p_ticket_type_id and tenant_id = v_tenant;
  update public.events set spots_left = greatest(spots_left - p_quantity, 0)
   where id = p_event_id and tenant_id = v_tenant;

  return jsonb_build_object(
    'order_id', v_order_id, 'subtotal', v_subtotal, 'discount', v_discount,
    'total', v_total, 'currency', v_tt.currency, 'discount_pct', v_best_pct
  );
end $fn$;

create or replace function public.fulfil_order(p_order_id uuid, p_payment_id uuid default null::uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_o      public.orders;
  v_codes  text[] := '{}';
  v_code   text;
  i        int;
  v_svc    boolean := auth.role() = 'service_role';
begin
  -- The webhook acts for the platform and may fulfil an order in any tenant.
  -- Everyone else is held to the tenant the request is about.
  select * into v_o from public.orders
   where id = p_order_id
     and (v_svc or tenant_id = public.bos_request_tenant())
   for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;

  if v_o.status = 'paid' then
    select coalesce(array_agg(ticket_code), '{}') into v_codes
      from public.registrations
     where order_id = p_order_id and tenant_id = v_o.tenant_id;
    return jsonb_build_object('ok', true, 'already', true, 'tickets', to_jsonb(v_codes));
  end if;
  if v_o.status <> 'pending' then raise exception 'ORDER_NOT_PENDING'; end if;

  -- The check that was missing entirely. A paid order needs a paid payment of
  -- at least its total, in its own tenant. Free orders -- which is how
  -- register_free_order reaches here -- need none, and the service role is
  -- trusted because only the verified webhook runs as it.
  if v_o.total > 0 and not v_svc then
    if p_payment_id is null or not exists (
      select 1 from public.payments p
       where p.id = p_payment_id
         and p.status = 'paid'
         and p.amount >= v_o.total
         and p.tenant_id = v_o.tenant_id)
    then
      raise exception 'PAYMENT_NOT_VERIFIED';
    end if;
  end if;

  for i in 1..v_o.quantity loop
    insert into public.registrations (
      event_id, user_id, ticket_type_id, order_id,
      attendee_name, attendee_email, attendee_phone, status, payment_id, tenant_id
    ) values (
      v_o.event_id, v_o.user_id, v_o.ticket_type_id, v_o.id,
      v_o.buyer_name, v_o.buyer_email, v_o.buyer_phone, 'registered', p_payment_id,
      v_o.tenant_id
    ) returning ticket_code into v_code;
    v_codes := array_append(v_codes, v_code);
  end loop;

  update public.orders
     set status = 'paid',
         payment_id = coalesce(p_payment_id, payment_id),
         expires_at = null
   where id = p_order_id;

  -- The promo is redeemed in the ORDER tenant rather than the request tenant.
  -- Calling redeem_promo would have used bos_request_tenant, which for the
  -- webhook is the default tenant, so a second business promo would never
  -- have been counted.
  if v_o.promo_code is not null then
    update public.promo_codes
       set uses = uses + 1
     where lower(code) = lower(trim(v_o.promo_code))
       and tenant_id = v_o.tenant_id
       and active
       and (expires_at is null or expires_at > now())
       and (max_uses is null or uses < max_uses);
  end if;

  return jsonb_build_object('ok', true, 'tickets', to_jsonb(v_codes));
end $fn$;

comment on function public.fulfil_order(uuid, uuid) is
  $c$Issues the tickets an order holds. Requires a paid payment row of at least the order total unless the order is free or the caller is the service role -- a check this function did not have, which made free tickets for a paid event a two-call sequence.$c$;

create or replace function public.register_free_order(
  p_event_id uuid, p_ticket_type_id uuid, p_quantity integer,
  p_buyer_name text, p_buyer_email text, p_buyer_phone text default null::text,
  p_answers jsonb default null::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_tt     public.ticket_types;
  v_order  jsonb;
  v_tenant uuid := public.bos_request_tenant();
begin
  select * into v_tt from public.ticket_types
   where id = p_ticket_type_id and event_id = p_event_id and tenant_id = v_tenant;
  if not found then raise exception 'TICKET_TYPE_NOT_FOUND'; end if;
  if v_tt.price_amount > 0 then raise exception 'NOT_FREE'; end if;

  if exists (
    select 1 from public.registrations r
     where r.event_id = p_event_id
       and r.tenant_id = v_tenant
       and r.attendee_email = p_buyer_email
       and r.status in ('registered', 'attended')
  ) then raise exception 'ALREADY_REGISTERED'; end if;

  v_order := public.create_pending_order(
    p_event_id, p_ticket_type_id, p_quantity,
    p_buyer_name, p_buyer_email, p_buyer_phone, null, null, p_answers
  );
  return public.fulfil_order((v_order->>'order_id')::uuid, null);
end $fn$;

create or replace function public.register_for_event(
  p_event_id uuid, p_attendee_name text, p_attendee_email text,
  p_attendee_phone text default null::text, p_payment_id uuid default null::uuid,
  p_user_id uuid default null::uuid)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_tt     public.ticket_types;
  v_order  jsonb;
  v_res    jsonb;
  v_tenant uuid := public.bos_request_tenant();
begin
  select * into v_tt from public.ticket_types
   where event_id = p_event_id and is_hidden = false and tenant_id = v_tenant
   order by sort_order, price_amount limit 1;
  if not found then raise exception 'TICKET_TYPE_NOT_FOUND'; end if;

  if v_tt.price_amount = 0 and exists (
    select 1 from public.registrations r
     where r.event_id = p_event_id
       and r.tenant_id = v_tenant
       and r.attendee_email = p_attendee_email
       and r.status in ('registered', 'attended')
  ) then raise exception 'ALREADY_REGISTERED'; end if;

  v_order := public.create_pending_order(
    p_event_id, v_tt.id, 1,
    p_attendee_name, p_attendee_email, p_attendee_phone, null, p_user_id
  );
  v_res := public.fulfil_order((v_order->>'order_id')::uuid, p_payment_id);
  return (v_res->'tickets'->>0);
end $fn$;

create or replace function public.cancel_registration(p_registration_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_reg    public.registrations;
  v_uid    uuid := auth.uid();
  v_event  public.events;
  v_next   public.registrations;
  v_did_promote boolean := false;
  v_svc    boolean := auth.role() = 'service_role';
  v_tenant uuid := public.bos_request_tenant();
begin
  select * into v_reg from public.registrations
   where id = p_registration_id
     and (v_svc or tenant_id = v_tenant)
   for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_reg.user_id is distinct from v_uid and not public.is_admin()
     and not exists (select 1 from public.events e
                      where e.id = v_reg.event_id and e.host_id = v_uid
                        and e.tenant_id = v_reg.tenant_id) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_event from public.events
   where id = v_reg.event_id and tenant_id = v_reg.tenant_id for update;

  if v_reg.status = 'registered' then
    select * into v_next from public.registrations
      where event_id = v_reg.event_id and status = 'waitlisted'
        and tenant_id = v_reg.tenant_id
      order by registered_at asc limit 1 for update;

    if found and v_event.price_amount = 0 then
      -- Free event: seat transfers to the waitlister automatically.
      update public.registrations set status = 'registered' where id = v_next.id;
      v_did_promote := true;
    else
      -- Paid event (or no waitlist): the seat returns to the pool.
      update public.events set spots_left = spots_left + 1
       where id = v_reg.event_id and tenant_id = v_reg.tenant_id;
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
end $fn$;

-- The door scanner. Ticket codes are deliberately globally unique, so the
-- lookup finds the right row -- the hole was the permission test below it,
-- which admitted any admin without asking whose event it was. Scoping the
-- lookup makes the message it already returns true.
create or replace function public.check_in_ticket(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_reg    public.registrations;
  v_event  public.events;
  v_tenant uuid := public.bos_request_tenant();
begin
  select * into v_reg from public.registrations
    where lower(ticket_code) = lower(trim(p_code))
      and tenant_id = v_tenant
    limit 1;
  if not found then
    return jsonb_build_object('status', 'invalid',
      'message', 'Ticket not found — or not for one of your events.');
  end if;

  select * into v_event from public.events
   where id = v_reg.event_id and tenant_id = v_tenant;

  if not (public.is_admin()
          or v_event.host_id = v_uid
          or public.bos_can_access('events')) then
    return jsonb_build_object('status', 'invalid',
      'message', 'Ticket not found — or not for one of your events.');
  end if;

  if v_reg.checked_in_at is not null or v_reg.status = 'attended' then
    return jsonb_build_object('status', 'already', 'message', 'Already checked in',
      'attendeeName', v_reg.attendee_name, 'eventTitle', v_event.title,
      'eventId', v_event.id, 'checkedInAt', v_reg.checked_in_at);
  end if;

  update public.registrations
    set status = 'attended', checked_in_at = now()
    where id = v_reg.id;

  if v_reg.user_id is not null then
    perform public.award_credits(
      v_reg.user_id, 10, 'Attended ' || coalesce(v_event.title, 'an event'), v_reg.event_id);
    perform public.refresh_badges(v_reg.user_id);
  end if;

  perform public.ensure_group_seed_post(v_reg.event_id);

  return jsonb_build_object('status', 'ok', 'message', 'Checked in',
    'attendeeName', v_reg.attendee_name, 'eventTitle', v_event.title,
    'eventId', v_event.id);
end $fn$;
