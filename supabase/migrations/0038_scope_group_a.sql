-- ============================================================
-- Stage 5, first batch: the reads that span rows.
--
-- A SECURITY DEFINER function bypasses RLS, so the isolation policies from
-- 0037 never run inside one. Measured before this migration: a tenant admin
-- reads 1 risk directly, and bos_govern_attention() hands him 2.
--
-- The architecture document ordered Stage 5 as E, B, C and D, then A. That
-- order was written on the assumption that FORCE ROW LEVEL SECURITY would be
-- closing the owner hole at Stage 4. It is not -- the owning role carries
-- BYPASSRLS, which FORCE does not remove -- so the only thing standing
-- between one tenant and another is a predicate inside each function body,
-- and A is where the rows actually cross. A goes first.
--
-- This batch is eight functions: every set-returning one, plus public_stats
-- and bos_event_slug. bos_dashboard_summary (two overloads) and
-- bos_section_status are 350 lines between them and come next, with the
-- remaining seven row-scoped functions.
--
-- Three of these read ONLY public.users, which is global by design and has no
-- tenant_id. They are scoped by joining tenant_members instead, and they
-- report the role held IN THIS TENANT rather than users.primary_role -- which
-- is the Group E change arriving early, because a directory that prints a
-- role has no honest way to avoid it.
--
-- With one tenant every one of these returns exactly what it returned before.
--
-- Idempotent. Run AFTER 0037.
-- ============================================================

-- ------------------------------------------------------------
-- 1. bos_govern_attention: everything overdue, in one list
--
-- Four tenant-owned tables, four predicates. Nothing else changes.
-- ------------------------------------------------------------
create or replace function public.bos_govern_attention()
returns table(area text, id uuid, label text, owner_id uuid, due date, days_late integer)
language sql
stable
security definer
set search_path = public
as $fn$
  select 'Risk', r.id, coalesce(r.code || ' ', '') || r.risk, r.owner_id, r.next_review,
         (current_date - r.next_review)::int
    from public.risks r
   where r.tenant_id = public.bos_request_tenant()
     and r.next_review is not null and r.next_review < current_date and r.closed_at is null
  union all
  select 'Legal', l.id, l.requirement, l.owner_id, l.due_date, (current_date - l.due_date)::int
    from public.legal_items l
   where l.tenant_id = public.bos_request_tenant()
     and l.due_date is not null and l.due_date < current_date and l.status::text <> 'completed'
  union all
  select 'Complaint', c.id, coalesce(c.ref || ' ', '') || c.subject, c.owner_id, c.resolve_by::date,
         (current_date - c.resolve_by::date)::int
    from public.complaints c
   where c.tenant_id = public.bos_request_tenant()
     and c.resolve_by is not null and c.resolve_by < now() and c.state not in ('resolved', 'closed')
  union all
  select 'Document', a.id, a.name, a.owner_id, a.review_date, (current_date - a.review_date)::int
    from public.assets a
   where a.tenant_id = public.bos_request_tenant()
     and a.review_date is not null and a.review_date < current_date;
$fn$;

-- ------------------------------------------------------------
-- 2. bos_user_directory: the staff list the OS renders names from
--
-- users is global, so the tenant comes from the membership. The role column
-- now reports the role held in THIS tenant, which is the point of
-- tenant_members: the same person may be an employee here and an admin
-- elsewhere, and this list should say employee.
-- ------------------------------------------------------------
create or replace function public.bos_user_directory()
returns table(id uuid, full_name text, email text, primary_role text)
language sql
stable
security definer
set search_path = public
as $fn$
  select u.id,
         u.full_name,
         -- An address is contact data, not a label. Staff get the name only.
         case when public.is_admin() then u.email else null end,
         tm.role::text
    from public.users u
    join public.tenant_members tm
      on tm.user_id = u.id
     and tm.tenant_id = public.bos_request_tenant()
     and tm.status = 'active'
   where public.is_admin()
      -- A colleague is nameable. A member is not, and has no business
      -- appearing anywhere in the Business OS.
      or (public.bos_is_staff()
          and tm.role::text in ('admin', 'employee', 'event_host'));
$fn$;

-- ------------------------------------------------------------
-- 3. get_directory: the public member directory
-- ------------------------------------------------------------
create or replace function public.get_directory()
returns table(id uuid, full_name text, city text, bio text, linkedin_url text, primary_role text)
language sql
stable
security definer
set search_path = public
as $fn$
  select u.id, u.full_name, u.city, u.bio, u.linkedin_url, tm.role::text
  from public.users u
  join public.tenant_members tm
    on tm.user_id = u.id
   and tm.tenant_id = public.bos_request_tenant()
   and tm.status = 'active'
  where public.is_paid_member()
    and u.discoverable = true
    and (
      u.points >= 100
      or exists (
        select 1 from public.memberships m
         where m.user_id = u.id and m.status = 'active' and m.tier::text = 'Elite'
           and m.tenant_id = public.bos_request_tenant()
      )
    );
$fn$;

-- ------------------------------------------------------------
-- 4. get_top_members: the leaderboard
--
-- users.points stays global, which is a data-model question for later: a
-- point earned at one business is currently a point everywhere. Scoping WHO
-- appears is the part that belongs to this stage.
-- ------------------------------------------------------------
create or replace function public.get_top_members(p_limit integer default 10)
returns table(full_name text, city text, points integer)
language sql
stable
security definer
set search_path = public
as $fn$
  select u.full_name, u.city, u.points
  from public.users u
  join public.tenant_members tm
    on tm.user_id = u.id
   and tm.tenant_id = public.bos_request_tenant()
   and tm.status = 'active'
  where u.discoverable = true and u.points > 0
  order by u.points desc
  limit least(coalesce(p_limit, 10), 50);
$fn$;

-- ------------------------------------------------------------
-- 5. public_stats: the numbers on the public home page
--
-- Read by anonymous visitors, which is why it is definer. The member count
-- becomes a count of memberships rather than of accounts, because an account
-- is global and a member belongs to a business.
-- ------------------------------------------------------------
create or replace function public.public_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select jsonb_build_object(
    'members',  (select count(*) from public.tenant_members
                  where tenant_id = public.bos_request_tenant() and status = 'active'),
    'events',   (select count(*) from public.events
                  where tenant_id = public.bos_request_tenant()
                    and status = 'published' and date < current_date),
    'partners', (select count(*) from public.partners
                  where tenant_id = public.bos_request_tenant() and is_active),
    'cities',   (select count(*) from public.cities
                  where tenant_id = public.bos_request_tenant() and is_active)
  );
$fn$;

-- ------------------------------------------------------------
-- 6. event_attendance: who is going, for a list of events
--
-- The event ids are passed in and were never checked for ownership. Filtering
-- the registrations is what makes another tenant event ids answer zero.
-- ------------------------------------------------------------
create or replace function public.event_attendance(p_event_ids uuid[])
returns table(event_id uuid, going integer, names text[])
language sql
stable
security definer
set search_path = public
as $fn$
  select
    e.id as event_id,
    coalesce(g.going, 0)::int as going,
    case
      when not public.is_paid_member() then '{}'::text[]
      else coalesce(g.names, '{}'::text[])
    end as names
  from unnest(p_event_ids) as e(id)
  left join lateral (
    select
      count(*)::int as going,
      (array_agg(u.full_name order by r.registered_at)
         filter (where u.discoverable and u.full_name is not null))[1:5] as names
    from public.registrations r
    left join public.users u on u.id = r.user_id
    where r.event_id = e.id
      and r.tenant_id = public.bos_request_tenant()
      and r.status in ('registered','attended')
  ) g on true;
$fn$;

-- ------------------------------------------------------------
-- 7. get_all_host_earnings: every host money
--
-- The sharpest of the eleven. Payments, events and payouts are all
-- tenant-owned, so all three get a predicate.
-- ------------------------------------------------------------
create or replace function public.get_all_host_earnings()
returns table(host_id uuid, host_name text, host_email text, gross bigint,
              platform_fee bigint, net bigint, paid_out bigint, balance bigint)
language sql
stable
security definer
set search_path = public
as $fn$
  with gross as (
    select e.host_id, coalesce(sum(p.amount), 0)::bigint as amt
    from public.payments p
    join public.events e on e.id = p.related_id and p.related_type = 'events'
    where p.stream = 'ticket_sales' and p.status = 'paid' and e.host_id is not null
      and p.tenant_id = public.bos_request_tenant()
      and e.tenant_id = public.bos_request_tenant()
    group by e.host_id
  ),
  paid as (
    select host_id, coalesce(sum(amount), 0)::bigint as amt
    from public.payouts
    where tenant_id = public.bos_request_tenant()
    group by host_id
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
$fn$;

-- ------------------------------------------------------------
-- 8. bos_event_slug: a readable URL for an event
--
-- Slugs became unique per tenant in 0036, so the uniqueness scan has to be
-- too. Without this, the second business to run a Summit gets summit-2 for
-- no reason a reader could work out.
-- ------------------------------------------------------------
create or replace function public.bos_event_slug(p_title text, p_id uuid default null::uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_base   text;
  v_slug   text;
  v_n      int := 1;
  v_tenant uuid := public.bos_request_tenant();
begin
  v_base := regexp_replace(lower(trim(coalesce(p_title, ''))), '[^a-z0-9]+', '-', 'g');
  v_base := trim(both '-' from v_base);
  if v_base = '' then v_base := 'event'; end if;
  v_slug := v_base;

  while exists (
    select 1 from public.events e
     where e.slug = v_slug and e.tenant_id = v_tenant and (p_id is null or e.id <> p_id)
  ) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;

  return v_slug;
end;
$fn$;
