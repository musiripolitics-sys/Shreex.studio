-- ============================================================
-- An admin of one business could see any row in any business.
--
-- Found by the Stage 6 isolation test on its first run, which is exactly what
-- that test exists for. The architecture document called it "the control that
-- actually prevents the leak" and it earned the description immediately.
--
-- Four predicates have the shape
--
--   select public.is_admin()
--       or exists (... the row is mine ...)
--       or exists (... the row is linked to mine ...)
--
-- 0040 scoped every one of those exists() branches and left is_admin()
-- standing alone at the front. is_admin() answers "am I an admin of the
-- business I am acting in" -- it says nothing about the row being asked
-- about. So the first branch short-circuits and any admin passes for any row,
-- however carefully the rest was scoped. bos_can_see_task answered true about
-- another business task to an admin who could not read a single row of it
-- directly.
--
-- The fix is not another predicate on each branch. It is an outer gate: the
-- row has to be in the caller business before any branch is consulted. That
-- also makes the inner predicates redundant, and they are left in place
-- anyway -- they cost nothing and they keep each branch readable on its own.
--
-- Three other functions matched the same pattern on a text search and are
-- NOT affected, because they look the row up scoped BEFORE testing is_admin:
-- get_event_stats and notify_followers raise EVENT_NOT_FOUND, and unlock_file
-- returns "File not found". Their admin branch only ever sees a row already
-- confirmed to be in the caller tenant.
--
-- Idempotent. Run AFTER 0045.
-- ============================================================

create or replace function public.bos_can_see_task(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  -- The task has to be in this business before anything else is asked.
  select exists (select 1 from public.tasks t
                  where t.id = p_task
                    and t.tenant_id = public.bos_request_tenant())
     and (
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
                     and m.tenant_id = public.bos_request_tenant())
     );
$fn$;

create or replace function public.bos_can_see_goal(p_goal uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (select 1 from public.goals g
                  where g.id = p_goal
                    and g.tenant_id = public.bos_request_tenant())
     and (
       public.is_admin()
       or exists (select 1 from public.goals g
                   where g.id = p_goal and g.owner_id = auth.uid()
                     and g.tenant_id = public.bos_request_tenant())
       or exists (select 1 from public.tasks t
                   where t.goal_id = p_goal and t.owner_id = auth.uid()
                     and t.tenant_id = public.bos_request_tenant())
     );
$fn$;

create or replace function public.can_read_community(p_community uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (select 1 from public.communities c
                  where c.id = p_community
                    and c.tenant_id = public.bos_request_tenant())
     and (
       public.is_admin()
       or exists (select 1 from public.communities c
                   where c.id = p_community and c.is_public
                     and c.tenant_id = public.bos_request_tenant())
       or public.is_community_member(p_community)
     );
$fn$;

create or replace function public.community_leads(p_community uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (select 1 from public.communities c
                  where c.id = p_community
                    and c.tenant_id = public.bos_request_tenant())
     and (
       public.is_admin()
       or exists (
            select 1 from public.community_members m
             where m.community_id = p_community
               and m.user_id = auth.uid()
               and m.state = 'active'
               and m.tenant_id = public.bos_request_tenant()
               and m.role in ('organizer','co_organizer'))
     );
$fn$;
