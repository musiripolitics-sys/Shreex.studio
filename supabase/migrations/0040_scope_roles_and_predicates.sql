-- ============================================================
-- Stage 5, third batch: Group E and Group B together.
--
-- They cannot be separated. Nearly every Group B predicate opens with
-- "public.is_admin() or ...", so adding tenant predicates to the other
-- branches of bos_can_see_task while is_admin stays tenant-blind would leave
-- the short circuit wide open and the function would still answer true about
-- another business task. Measured before this: Ben reads 0 rows for Ada task
-- and bos_can_see_task() answers true about it.
--
-- This is the change the architecture document called the most consequential
-- in the project: role stops being a property of a USER and becomes a
-- property of a MEMBERSHIP. is_admin is called from roughly 200 policies.
--
-- ------------------------------------------------------------
-- The staleness problem, and how it is handled
--
-- tenant_members.role was copied from users.primary_role when 0034 ran, and
-- the trigger copies it when an account is created. Nothing copies it when
-- an account is PROMOTED -- createEmployee updates users.primary_role on an
-- existing account -- so a membership role can go stale, and reading only
-- tenant_members would quietly demote whoever that happened to.
--
-- Two measures. The roles are re-synced from primary_role below, because
-- 0034 ran recently and nothing has deliberately diverged yet. And the
-- predicates keep a legacy fallback to users.primary_role, but ONLY inside
-- the default tenant. That shape matters: in Techxfluence a drifted role
-- cannot lock anybody out, and in any other tenant the membership is the
-- only authority, so a stale platform-wide admin flag cannot leak admin
-- rights sideways into a business someone merely belongs to.
--
-- Stage 7 removes the fallback, once roles are managed on the membership.
--
-- Idempotent. Run AFTER 0039.
-- ============================================================

-- ------------------------------------------------------------
-- 0. Re-sync the membership roles
-- ------------------------------------------------------------
update public.tenant_members m
   set role = u.primary_role
  from public.users u
 where u.id = m.user_id
   and m.role <> u.primary_role
   and m.tenant_id = (select id from public.tenants where is_default);

-- ------------------------------------------------------------
-- 1. Group E: who the caller is, in this tenant
-- ------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $fn$
  select exists (
    select 1
      from public.tenant_members m
     where m.user_id = auth.uid()
       and m.tenant_id = public.bos_request_tenant()
       and m.status = 'active'
       and (
            m.role = 'admin'
            -- Legacy, default tenant only. See the header.
         or (m.tenant_id = (select id from public.tenants where is_default)
             and (exists (select 1 from public.users u
                           where u.id = m.user_id and u.primary_role = 'admin')
               or exists (select 1 from public.user_roles r
                           where r.user_id = m.user_id and r.role = 'admin')))
       ));
$fn$;

comment on function public.is_admin() is
  $c$Whether the caller is an admin OF THE TENANT THIS REQUEST IS ABOUT. Being an admin of one business grants nothing in another. The users.primary_role fallback applies only inside the default tenant and goes away in Stage 7.$c$;

create or replace function public.bos_is_staff()
returns boolean
language sql
security definer
set search_path = public
as $fn$
  select public.is_admin() or exists (
    select 1
      from public.tenant_members m
     where m.user_id = auth.uid()
       and m.tenant_id = public.bos_request_tenant()
       and m.status = 'active'
       and (
            m.role::text = 'employee'
         or (m.tenant_id = (select id from public.tenants where is_default)
             and exists (select 1 from public.users u
                          where u.id = m.user_id and u.primary_role::text = 'employee'))
       ));
$fn$;

create or replace function public.is_employee()
returns boolean
language sql
security definer
set search_path = public
as $fn$
  select public.bos_is_staff();
$fn$;

comment on function public.is_employee() is
  $c$Kept as a name the policies already use. It and bos_is_staff asked the same question in two slightly different ways, which is one way for them to drift apart.$c$;

create or replace function public.is_host()
returns boolean
language sql
security definer
set search_path = public
as $fn$
  select exists (
    select 1
      from public.tenant_members m
     where m.user_id = auth.uid()
       and m.tenant_id = public.bos_request_tenant()
       and m.status = 'active'
       and (
            m.role::text in ('event_host', 'admin')
         or (m.tenant_id = (select id from public.tenants where is_default)
             and exists (select 1 from public.users u
                          where u.id = m.user_id
                            and u.primary_role::text in ('event_host', 'admin')))
       ));
$fn$;

-- A tier is sold by a business, so it is held in one.
create or replace function public.member_tier()
returns text
language sql
stable
security definer
set search_path = public
as $fn$
  select m.tier::text
    from public.memberships m
   where m.user_id = auth.uid()
     and m.tenant_id = public.bos_request_tenant()
     and m.status = 'active'
     and (m.renews_at is null or m.renews_at >= now())
     and m.tier::text in ('Pro','Elite')
   limit 1;
$fn$;

-- is_paid_member needs no predicate of its own: both of its delegates are
-- scoped now. Re-declared so the comment records that it was considered
-- rather than missed.
create or replace function public.is_paid_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select public.is_admin() or public.member_tier() is not null;
$fn$;

comment on function public.is_paid_member() is
  $c$Scoped through its delegates: is_admin and member_tier both answer per tenant since 0040. No predicate of its own.$c$;

create or replace function public.meets_gate(p_action text)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select public.is_admin() or coalesce((
    select u.points >= g.min_balance
      from public.users u
      join public.community_gates g
        on g.action = p_action
       and g.tenant_id = public.bos_request_tenant()
     where u.id = auth.uid()
  ), true);
$fn$;

-- ------------------------------------------------------------
-- 2. Group B: may the caller see this row
-- ------------------------------------------------------------
create or replace function public.bos_can_see_task(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select
    public.is_admin()
    or exists (select 1 from public.tasks t
                where t.id = p_task and t.owner_id = auth.uid()
                  and t.tenant_id = public.bos_request_tenant())
    -- what one of mine waits on, via the critical path
    or exists (select 1 from public.tasks m
                where m.owner_id = auth.uid() and m.dependency_id = p_task
                  and m.tenant_id = public.bos_request_tenant())
    -- what one of mine waits on, via the dependency graph
    or exists (select 1 from public.dependencies d
                 join public.tasks m on m.id = d.from_id
                where m.owner_id = auth.uid() and d.to_id = p_task
                  and m.tenant_id = public.bos_request_tenant())
    -- and what waits on one of mine, so "Blocks" is not blank
    or exists (select 1 from public.tasks t
                where t.id = p_task
                  and t.tenant_id = public.bos_request_tenant()
                  and t.dependency_id in (select id from public.tasks
                                           where owner_id = auth.uid()
                                             and tenant_id = public.bos_request_tenant()))
    or exists (select 1 from public.dependencies d
                 join public.tasks m on m.id = d.to_id
                where m.owner_id = auth.uid() and d.from_id = p_task
                  and m.tenant_id = public.bos_request_tenant());
$fn$;

create or replace function public.bos_can_see_goal(p_goal uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select
    public.is_admin()
    or exists (select 1 from public.goals g
                where g.id = p_goal and g.owner_id = auth.uid()
                  and g.tenant_id = public.bos_request_tenant())
    or exists (select 1 from public.tasks t
                where t.goal_id = p_goal and t.owner_id = auth.uid()
                  and t.tenant_id = public.bos_request_tenant());
$fn$;

-- A grant belongs to a membership, not to an account. Without the predicate,
-- being granted Plan at one business granted it at every business.
create or replace function public.bos_can_access(p_section text)
returns boolean
language sql
security definer
stable
set search_path = public
as $fn$
  select exists (
           select 1 from public.products
            where key = p_section and is_enabled
         )
     and (
           public.is_admin()
        or exists (
             select 1 from public.employee_module_access
              where user_id = auth.uid() and section = p_section
                and tenant_id = public.bos_request_tenant())
         );
$fn$;

create or replace function public.bos_my_sections()
returns text[]
language plpgsql
security definer
stable
set search_path = public
as $fn$
begin
  if auth.uid() is null then
    return array[]::text[];
  end if;

  -- An admin always has every enabled product, granted or not.
  if public.is_admin() then
    return coalesce(
      (select array_agg(key order by sort_order, key)
         from public.products where is_enabled),
      array[]::text[]);
  end if;

  return coalesce(
    (select array_agg(p.key order by p.sort_order, p.key)
       from public.employee_module_access a
       join public.products p on p.key = a.section
      where a.user_id = auth.uid()
        and a.tenant_id = public.bos_request_tenant()
        and p.is_enabled),
    array[]::text[]);
end $fn$;

create or replace function public.is_community_member(p_community uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.community_members m
     where m.community_id = p_community
       and m.user_id = auth.uid()
       and m.state = 'active'
       and m.tenant_id = public.bos_request_tenant()
  );
$fn$;

create or replace function public.community_leads(p_community uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select public.is_admin() or exists (
    select 1 from public.community_members m
     where m.community_id = p_community
       and m.user_id = auth.uid()
       and m.state = 'active'
       and m.tenant_id = public.bos_request_tenant()
       and m.role in ('organizer','co_organizer')
  );
$fn$;

create or replace function public.can_read_community(p_community uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select public.is_admin()
      or exists (select 1 from public.communities c
                  where c.id = p_community and c.is_public
                    and c.tenant_id = public.bos_request_tenant())
      or public.is_community_member(p_community);
$fn$;

create or replace function public.attended(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.registrations r
    where r.event_id = p_event_id and r.user_id = auth.uid()
      and r.status = 'attended'
      and r.tenant_id = public.bos_request_tenant()
  );
$fn$;
