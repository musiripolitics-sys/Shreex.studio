-- ============================================================
-- Stage 5, second batch: the rest of Group A.
--
-- Ten functions. Three of them needed a decision rather than a predicate,
-- and those decisions are the substance of this migration.
--
-- Idempotent. Run AFTER 0038.
-- ============================================================

-- ------------------------------------------------------------
-- 1. bos_dashboard_summary(date, date) is dropped, not scoped
--
-- It cannot be called. Both overloads default every argument, so a two-date
-- call matches the four-argument one as well and Postgres refuses:
-- "function public.bos_dashboard_summary(date, date) is not unique".
-- Both call sites in the app pass all four named arguments, which resolves
-- to the other one. Scoping a function nothing can reach would have been
-- 97 lines of work to protect dead code.
-- ------------------------------------------------------------
drop function if exists public.bos_dashboard_summary(date, date);

-- ------------------------------------------------------------
-- 2. bos_dashboard_summary(date, date, uuid, uuid) becomes SECURITY INVOKER
--
-- Not a predicate: a removal. The function raises FORBIDDEN unless the
-- caller is an admin, and an admin can already read every one of the 27
-- tables it touches under the policies written in 0007 and 0018. So it never
-- needed to bypass RLS, and as an invoker the isolation policies from 0037
-- scope all 35 of its subqueries at once.
--
-- Measured before changing it: with an admin and data in nine tables, the
-- definer and invoker versions returned all 66 keys identical. Every table
-- it reads was also checked for a permissive SELECT policy an admin
-- satisfies, so a count cannot silently drop to zero.
--
-- This is the same reasoning that kept bos_search an invoker function, and
-- it is the better fix where it applies: thirty-five hand-inserted
-- predicates is thirty-five chances to mistype one.
-- ------------------------------------------------------------
alter function public.bos_dashboard_summary(date, date, uuid, uuid) security invoker;

comment on function public.bos_dashboard_summary(date, date, uuid, uuid) is
  $c$The admin dashboard numbers. SECURITY INVOKER on purpose: the caller is already an admin, so RLS gives the right answer and the tenant isolation policies scope every subquery without a predicate in any of them.$c$;

-- ------------------------------------------------------------
-- 3. bos_section_status: a predicate, because invoker would change answers
--
-- This one is gated on bos_is_staff rather than is_admin, and an employee
-- read policy on these 32 tables is narrower than an admin one. As an
-- invoker the counts would quietly shrink to what that employee can read,
-- which is a different number from the one the nav is asking for. So it
-- stays definer and the dynamic SQL carries the tenant.
--
-- Five edits rather than ninety-four lines: every count already goes through
-- execute format on a table name, so the predicate goes in the format string.
-- All 32 tables in the list are tenant-owned.
-- ------------------------------------------------------------
create or replace function public.bos_section_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  r        record;
  v_out    jsonb := '{}'::jsonb;
  v_total  int;
  v_open   int;
  v_over   int;
  v_tenant uuid := public.bos_request_tenant();
  v_done   constant text :=
    '''completed'',''cancelled'',''done'',''closed'',''published'',''archived'','
    || '''resolved'',''filled'',''won'',''lost'',''rejected'',''inactive'',''retired''';
begin
  if not public.bos_is_staff() then raise exception 'FORBIDDEN'; end if;

  for r in
    select * from (values
      -- key,            table,               date column,      status column,       section
      ('roadmap',        'goals',             'end_date',       'status',            'plan'),
      ('tasks',          'tasks',             'due_date',       'status',            'plan'),
      ('dependencies',   'dependencies',      null,             'status',            'plan'),
      ('reviews',        'reviews',           null,             null,                'plan'),
      ('task_reviews',   'task_reviews',      null,             'outcome',           'plan'),
      ('events',         'events',            null,             null,                'events'),
      ('sops',           'sops',              'next_review',    'status',            'events'),
      ('finance',        'revenue_entries',   null,             null,                'money'),
      ('expenses',       'expenses',          null,             null,                'money'),
      ('cashflow',       'cashflow_months',   null,             null,                'money'),
      ('vendors',        'vendors',           'end_date',       'status',            'money'),
      ('membership',     'memberships',       null,             null,                'grow'),
      ('crm',            'leads',             'next_follow_up', 'stage',             'grow'),
      ('partnerships',   'partnerships',      'end_date',       'status',            'grow'),
      ('influencers',    'influencers',       null,             'status',            'grow'),
      ('ambassadors',    'ambassadors',       null,             'status',            'grow'),
      ('campaigns',      'campaigns',         'end_date',       'status',            'marketing'),
      ('content',        'content_items',     'content_date',   'status',            'marketing'),
      ('podcast',        'podcast_episodes',  'recording_date', 'publishing_status', 'marketing'),
      ('competitors',    'competitors',       'review_date',    null,                'marketing'),
      ('people',         'employee_profiles', null,             'status',            'team'),
      ('hiring',         'hiring_plan',       'start_date',     'status',            'team'),
      ('empkpis',        'employee_kpis',     null,             null,                'team'),
      ('product',        'app_modules',       'target_date',    'status',            'product'),
      ('feedback',       'feedback',          null,             null,                'product'),
      ('approvals',      'approvals',         null,             'decision',          'govern'),
      ('risks',          'risks',             'due_date',       'status',            'govern'),
      ('legal',          'legal_items',       'due_date',       'status',            'govern'),
      ('kpis',           'kpis',              null,             null,                'govern'),
      ('assets',         'assets',            'review_date',    'status',            'govern'),
      ('inventory',      'inventory',         null,             'status',            'govern'),
      ('audit',          'audit_log',         null,             null,                'govern')
    ) as t(key, tbl, date_col, status_col, section)
  loop
    if to_regclass('public.' || r.tbl) is null then continue; end if;
    -- Counts follow the grant, so an ungranted section is absent rather
    -- than present with a number the caller should not have.
    if not public.bos_can_access(r.section) then continue; end if;

    execute format('select count(*) from public.%I where tenant_id = %L', r.tbl, v_tenant)
      into v_total;

    if r.status_col is not null then
      execute format('select count(*) from public.%I where tenant_id = %L and %I::text not in (%s)',
                     r.tbl, v_tenant, r.status_col, v_done) into v_open;
    else
      v_open := null;
    end if;

    if r.date_col is not null then
      if r.status_col is not null then
        execute format(
          'select count(*) from public.%I where tenant_id = %L and %I < current_date and %I::text not in (%s)',
          r.tbl, v_tenant, r.date_col, r.status_col, v_done) into v_over;
      else
        execute format('select count(*) from public.%I where tenant_id = %L and %I < current_date',
                       r.tbl, v_tenant, r.date_col) into v_over;
      end if;
    else
      v_over := 0;
    end if;

    v_out := v_out || jsonb_build_object(
      r.key, jsonb_build_object('total', v_total, 'open', v_open, 'overdue', v_over));
  end loop;

  if to_regclass('public.task_reviews') is not null and public.bos_can_access('plan') then
    select count(*) into v_over from public.task_reviews
     where outcome = 'pending' and tenant_id = v_tenant;
    v_out := jsonb_set(v_out, '{task_reviews,overdue}', to_jsonb(v_over));
  end if;

  return v_out;
end $fn$;

-- ------------------------------------------------------------
-- 4. The seven that take an id and never checked whose it was
--
-- Lower severity than a set-returning leak and the same shape as any other
-- insecure direct object reference: pass an id from another business and the
-- function answers about it.
-- ------------------------------------------------------------
create or replace function public.bos_sop_current(p_sop uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $fn$
  select id from public.sop_versions
   where sop_id = p_sop
     and tenant_id = public.bos_request_tenant()
   order by (approved_at is not null) desc, version desc
   limit 1;
$fn$;

create or replace function public.bos_task_completion_block(p_task uuid)
returns text
language sql
stable
security definer
set search_path = public
as $fn$
  select case
    when t.owner_id is null
      then 'Assign this task to someone before completing it.'
    when not exists (select 1 from public.task_comments c where c.task_id = t.id)
      then 'Leave a comment saying what was done before completing it.'
    when t.approval_state <> 'approved' and not public.is_admin()
      then 'An admin has to approve this before it can be completed.'
    else null
  end
  from public.tasks t
 where t.id = p_task
   and t.tenant_id = public.bos_request_tenant();
$fn$;

create or replace function public.member_discount_pct(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce((
    select case when m.tier = 'Elite' then 50
                when m.tier = 'Pro'   then 25
                else 0 end
    from public.memberships m
    where m.user_id = p_user_id
      and m.tenant_id = public.bos_request_tenant()
      and m.status = 'active'
      and (m.renews_at is null or m.renews_at > now())
    limit 1
  ), 0);
$fn$;

-- A promo code is looked up by code alone, and 0036 made codes unique per
-- tenant. Without this, one business LAUNCH50 discounts the other tickets.
create or replace function public.validate_promo(p_code text)
returns integer
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce((
    select percent_off from public.promo_codes
    where lower(code) = lower(trim(p_code)) and active
      and tenant_id = public.bos_request_tenant()
      and (expires_at is null or expires_at > now())
      and (max_uses is null or uses < max_uses)
  ), 0);
$fn$;

-- Already filtered to auth.uid(), so it leaked nothing. It still has to be
-- scoped: one person hosting in two businesses would otherwise be shown one
-- merged balance and paid twice from the wrong pot.
create or replace function public.get_host_earnings()
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  with gross as (
    select coalesce(sum(p.amount), 0) as amt
    from public.payments p
    join public.events e on e.id = p.related_id and p.related_type = 'events'
    where e.host_id = auth.uid() and p.stream = 'ticket_sales' and p.status = 'paid'
      and p.tenant_id = public.bos_request_tenant()
      and e.tenant_id = public.bos_request_tenant()
  ),
  paid as (
    select coalesce(sum(amount), 0) as amt from public.payouts
     where host_id = auth.uid() and tenant_id = public.bos_request_tenant()
  )
  select jsonb_build_object(
    'gross', (select amt from gross),
    'platform_fee', ((select amt from gross) / 10),
    'net', ((select amt from gross) * 9 / 10),
    'paid_out', (select amt from paid),
    'balance', ((select amt from gross) * 9 / 10) - (select amt from paid)
  );
$fn$;

-- The public organizer page. users is global, so membership decides whether
-- this business has an organizer by that id, and the role comes from the
-- membership rather than from users.primary_role.
create or replace function public.get_organizer(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select case when u.id is null then null else jsonb_build_object(
    'id',          u.id,
    'name',        u.full_name,
    'city',        u.city,
    'bio',         u.bio,
    'linkedin',    u.linkedin_url,
    'events_count',(select count(*) from public.events e
                    where e.host_id = u.id and e.status = 'published'
                      and e.tenant_id = public.bos_request_tenant()),
    'followers',   (select count(*) from public.organizer_follows f
                    where f.organizer_id = u.id
                      and f.tenant_id = public.bos_request_tenant())
  ) end
  from public.users u
  join public.tenant_members tm
    on tm.user_id = u.id
   and tm.tenant_id = public.bos_request_tenant()
   and tm.status = 'active'
  where u.id = p_id
    and tm.role::text in ('event_host', 'admin')
    -- Only someone actually running public events gets a public page.
    and exists (select 1 from public.events e
                where e.host_id = u.id and e.status = 'published'
                  and e.tenant_id = public.bos_request_tenant());
$fn$;

-- The event is fetched by id with no ownership check, and the permission test
-- below it admits any admin. Adding the tenant to the lookup is what makes
-- another business event raise EVENT_NOT_FOUND rather than report its takings.
create or replace function public.get_event_stats(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_ev     public.events;
  v_tenant uuid := public.bos_request_tenant();
begin
  select * into v_ev from public.events
   where id = p_event_id and tenant_id = v_tenant;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  if not (public.is_admin() or v_ev.host_id = auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;

  return jsonb_build_object(
    'revenue', (
      select coalesce(sum(p.amount), 0) from public.payments p
      where p.related_type = 'events' and p.related_id = p_event_id and p.status = 'paid'
        and p.tenant_id = v_tenant
    ),
    'tickets', (
      select count(*) from public.registrations r
      where r.event_id = p_event_id and r.status in ('registered', 'attended')
        and r.tenant_id = v_tenant
    ),
    'checked_in', (
      select count(*) from public.registrations r
      where r.event_id = p_event_id and r.status = 'attended' and r.tenant_id = v_tenant
    ),
    'waitlisted', (
      select count(*) from public.registrations r
      where r.event_id = p_event_id and r.status = 'waitlisted' and r.tenant_id = v_tenant
    ),
    'last7', (
      select count(*) from public.registrations r
      where r.event_id = p_event_id and r.registered_at > now() - interval '7 days'
        and r.tenant_id = v_tenant
    ),
    'tiers', (
      select coalesce(
        jsonb_agg(jsonb_build_object(
          'name', t.name, 'sold', t.sold, 'capacity', t.capacity, 'price', t.price_amount
        ) order by t.sort_order), '[]'::jsonb)
      from public.ticket_types t
      where t.event_id = p_event_id and t.tenant_id = v_tenant
    )
  );
end $fn$;
