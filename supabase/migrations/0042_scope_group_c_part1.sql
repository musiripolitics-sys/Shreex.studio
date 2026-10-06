-- ============================================================
-- Stage 5, fourth batch: thirteen of the twenty-eight Group C mutators.
--
-- Group C is where a missing predicate stops being disclosure and becomes
-- damage. These functions act on a row named by an argument, and a definer
-- function bypasses RLS, so until now an admin of one business could cancel
-- another business registration, resolve its reports, or publish its
-- procedures by passing the id.
--
-- Thirteen rather than all twenty-eight on purpose. The remaining fifteen are
-- the ticket and order chain -- create_pending_order, fulfil_order,
-- register_for_event, register_free_order, cancel_registration,
-- check_in_ticket -- plus the community and credit functions. They call each
-- other, so they are worth doing as one piece with their own tests rather
-- than half now.
--
-- Idempotent. Run AFTER 0041.
-- ============================================================

-- ------------------------------------------------------------
-- Money
-- ------------------------------------------------------------

-- A payout is money leaving a business, to someone who works for it. The
-- membership check is the point: p_host_id was never checked at all.
create or replace function public.record_payout(p_host_id uuid, p_amount integer, p_note text default null::text)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if not exists (select 1 from public.tenant_members m
                  where m.user_id = p_host_id
                    and m.tenant_id = public.bos_request_tenant()
                    and m.status = 'active')
  then raise exception 'NOT_IN_THIS_TENANT'; end if;

  insert into public.payouts (host_id, amount, note, created_by, tenant_id)
  values (p_host_id, p_amount, p_note, auth.uid(), public.bos_request_tenant())
  returning id into v_id;

  perform public.notify(
    p_host_id, 'payout', 'Payout sent 💸',
    'A payout of ₹' || (p_amount / 100)::text || ' is on its way to you.',
    '/host/dashboard'
  );
  return v_id;
end $fn$;

-- The tenant is written explicitly rather than left to the column default.
-- The default would give the same answer today; naming it means the row does
-- not depend on a default staying in place.
create or replace function public.record_sponsorship(p_amount integer, p_note text default null::text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  insert into public.payments (user_id, stream, amount, currency, status, provider, provider_ref, tenant_id)
  values (auth.uid(), 'sponsorship', p_amount, 'INR', 'paid', 'manual', null,
          public.bos_request_tenant());
end $fn$;

-- This one was not merely leaky, it was broken: matching on the code alone,
-- with two businesses holding LAUNCH50, the update reached both rows and
-- failed with "query returned more than one row".
create or replace function public.redeem_promo(p_code text)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare v_pct int;
begin
  update public.promo_codes
     set uses = uses + 1
   where lower(code) = lower(trim(p_code)) and active
     and tenant_id = public.bos_request_tenant()
     and (expires_at is null or expires_at > now())
     and (max_uses is null or uses < max_uses)
  returning percent_off into v_pct;
  return coalesce(v_pct, 0);
end $fn$;

-- ------------------------------------------------------------
-- Access and roles
-- ------------------------------------------------------------

-- Grants are per membership since 0040, so the writes have to be too.
-- Without the tenant on the delete, revoking a section in one business
-- revoked it in every business the person belonged to.
create or replace function public.bos_set_module_access(p_user uuid, p_sections text[])
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_count   int;
  v_unknown text;
  v_tenant  uuid := public.bos_request_tenant();
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_user = auth.uid() then
    raise exception 'CANNOT_EDIT_OWN_ACCESS';
  end if;
  if not exists (select 1 from public.tenant_members m
                  where m.user_id = p_user and m.tenant_id = v_tenant and m.status = 'active')
  then raise exception 'NOT_IN_THIS_TENANT'; end if;

  select string_agg(s, ', ') into v_unknown
    from unnest(coalesce(p_sections, array[]::text[])) s
   where not exists (select 1 from public.products where key = s);
  if v_unknown is not null then
    raise exception 'UNKNOWN_PRODUCT: %', v_unknown;
  end if;

  delete from public.employee_module_access
   where user_id = p_user
     and tenant_id = v_tenant
     and (p_sections is null or section <> all(p_sections));

  insert into public.employee_module_access (user_id, section, granted_by, tenant_id)
  select p_user, s, auth.uid(), v_tenant
    from unnest(coalesce(p_sections, array[]::text[])) s
  on conflict (tenant_id, user_id, section) do nothing;

  select count(*) into v_count
    from public.employee_module_access
   where user_id = p_user and tenant_id = v_tenant;
  return v_count;
end $fn$;

-- Approving a host is a decision one business makes. The role now goes on the
-- membership, which is where 0040 reads it from; users.host_status is still
-- written because the public site reads it, and it is retired in Stage 7
-- along with primary_role.
create or replace function public.decide_host(p_user_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_tenant uuid := public.bos_request_tenant();
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from public.tenant_members m
                  where m.user_id = p_user_id and m.tenant_id = v_tenant and m.status = 'active')
  then raise exception 'NOT_IN_THIS_TENANT'; end if;

  if p_approve then
    update public.tenant_members set role = 'event_host'
     where user_id = p_user_id and tenant_id = v_tenant;
    update public.users set host_status = 'approved' where id = p_user_id;
    perform public.notify(p_user_id, 'host', 'You''re now a Host 🎉',
      'Your host access was approved — you can submit and manage events.', '/host/dashboard');
  else
    update public.users set host_status = 'rejected' where id = p_user_id;
    perform public.notify(p_user_id, 'host', 'Host request update',
      'Your host access request wasn''t approved this time.', null);
  end if;
end $fn$;

-- ------------------------------------------------------------
-- Procedures, reports, communities
-- ------------------------------------------------------------
create or replace function public.bos_publish_sop(p_version uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_sop    uuid;
  v_tenant uuid := public.bos_request_tenant();
begin
  if not public.is_admin() then
    raise exception 'Only an admin can approve a procedure.' using errcode = 'check_violation';
  end if;

  select sop_id into v_sop from public.sop_versions
   where id = p_version and tenant_id = v_tenant;
  if v_sop is null then raise exception 'No such version.'; end if;

  update public.sop_versions
     set approved_by = auth.uid(), approved_at = now()
   where id = p_version and tenant_id = v_tenant;

  update public.sop_documents
     set state = 'published',
         updated_at = now(),
         next_review = current_date + make_interval(days => review_every_days)
   where id = v_sop and tenant_id = v_tenant;
end $fn$;

create or replace function public.resolve_report(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  update public.post_reports set resolved = true
   where id = p_report_id and tenant_id = public.bos_request_tenant();
end $fn$;

create or replace function public.leave_community(p_community uuid)
returns void
language sql
security definer
set search_path = public
as $fn$
  delete from public.community_members
   where community_id = p_community
     and user_id = auth.uid()
     and tenant_id = public.bos_request_tenant();
$fn$;

-- ------------------------------------------------------------
-- Credits, badges, notifications
-- ------------------------------------------------------------

-- users.points stays global, which is a data-model question for later: a
-- point earned at one business currently counts everywhere. What this closes
-- is who can be awarded them -- p_user was never checked, so any caller could
-- credit any account in the database.
create or replace function public.award_credits(p_user uuid, p_amount integer, p_reason text, p_event_id uuid default null::uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_tenant uuid := public.bos_request_tenant();
begin
  if p_user is null or p_amount = 0 then return; end if;
  if not exists (select 1 from public.tenant_members m
                  where m.user_id = p_user and m.tenant_id = v_tenant and m.status = 'active')
  then return; end if;

  update public.users set points = points + p_amount where id = p_user;
  insert into public.point_events (user_id, delta, reason, event_id, tenant_id)
  values (p_user, p_amount, p_reason, p_event_id, v_tenant);
end $fn$;

create or replace function public.refresh_badges(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_sessions int;
  v_posts    int;
  v_tenant   uuid := public.bos_request_tenant();
begin
  if p_user is null then return; end if;

  select count(*) into v_sessions from public.registrations
   where user_id = p_user and status = 'attended' and tenant_id = v_tenant;
  select count(*) into v_posts from public.posts
   where author_id = p_user and tenant_id = v_tenant;

  insert into public.user_badges (user_id, badge_id, tenant_id)
  select p_user, b.id, v_tenant
    from public.badges b
   where b.tenant_id = v_tenant
     and b.threshold is not null
     and ((b.criteria = 'attendance' and v_sessions >= b.threshold)
       or (b.criteria = 'posts'      and v_posts    >= b.threshold))
  on conflict (user_id, badge_id) do nothing;
end $fn$;

create or replace function public.notify(p_user_id uuid, p_type text, p_title text,
                                         p_body text default null::text,
                                         p_link text default null::text)
returns void
language sql
security definer
set search_path = public
as $fn$
  insert into public.notifications (user_id, type, title, body, link, tenant_id)
  values (p_user_id, p_type, p_title, p_body, p_link, public.bos_request_tenant());
$fn$;

comment on function public.notify(uuid, text, text, text, text) is
  $c$Writes a notification for another user, which is why it is definer: the policy on notifications is auth.uid() = user_id. The tenant is named rather than left to the column default, so the row does not depend on a default staying in place.$c$;

-- ------------------------------------------------------------
-- The daily sweeper
--
-- Deliberately cross-tenant WHEN there is no caller. It runs from the cron as
-- the service role, on behalf of the platform, and must expire stale orders
-- for every business rather than only the default one -- which is what
-- bos_request_tenant would have given it. When a signed-in person calls it,
-- it sweeps their business only.
-- ------------------------------------------------------------
create or replace function public.expire_pending_orders()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_o      record;
  v_n      int := 0;
  v_tenant uuid := case when auth.uid() is null then null else public.bos_request_tenant() end;
begin
  for v_o in
    select * from public.orders
     where status = 'pending' and expires_at is not null and expires_at < now()
       and (v_tenant is null or tenant_id = v_tenant)
     for update
  loop
    update public.ticket_types set sold = greatest(sold - v_o.quantity, 0)
      where id = v_o.ticket_type_id and tenant_id = v_o.tenant_id;
    update public.events set spots_left = spots_left + v_o.quantity
      where id = v_o.event_id and tenant_id = v_o.tenant_id;
    update public.orders set status = 'cancelled' where id = v_o.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $fn$;

comment on function public.expire_pending_orders() is
  $c$Sweeps every tenant when called with no auth.uid(), which is how the daily Netlify job runs it. Sweeps only the caller tenant otherwise. The cross-tenant branch is deliberate: it is a platform job, and scoping it to the default tenant would quietly stop it running for everybody else.$c$;

create or replace function public.join_waitlist(p_event_id uuid, p_attendee_name text,
                                                p_attendee_email text,
                                                p_attendee_phone text default null::text)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_event  public.events;
  v_ticket text;
  v_uid    uuid := auth.uid();
  v_tenant uuid := public.bos_request_tenant();
begin
  select * into v_event from public.events
   where id = p_event_id and tenant_id = v_tenant;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  if v_event.status <> 'published' then raise exception 'EVENT_NOT_OPEN'; end if;
  if v_event.date < current_date then raise exception 'EVENT_OVER'; end if;

  insert into public.registrations
    (event_id, user_id, attendee_name, attendee_email, attendee_phone, status, tenant_id)
  values (p_event_id, v_uid, p_attendee_name, p_attendee_email, p_attendee_phone,
          'waitlisted', v_tenant)
  returning ticket_code into v_ticket;
  return v_ticket;
exception when unique_violation then raise exception 'ALREADY_REGISTERED';
end $fn$;
