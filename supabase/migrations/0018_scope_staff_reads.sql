-- ============================================================
-- Close employee visibility at the database, not just in the pages.
--
-- "staff read tasks" let any employee select every task row. The pages
-- filtered to the signed-in person, but the API did not, so anyone with a
-- session could read the whole plan through PostgREST.
--
-- The difficulty is that scoping cannot be "owner_id = auth.uid()" alone.
-- A task blocked by somebody else's work has to be able to name it, or the
-- board reads "waiting on something" instead of saying what. So visibility
-- is: mine, plus whatever mine points at, plus whatever points at mine.
--
-- That relationship cannot be expressed as a subquery inside a policy on
-- tasks — the subquery is itself subject to the policy and Postgres raises
-- "infinite recursion detected". It is computed by a security definer
-- function instead, which reads the table with RLS bypassed.
--
-- Idempotent. Run AFTER 0016.
-- ============================================================

-- ------------------------------------------------------------
-- May the caller see this task?
-- ------------------------------------------------------------
create or replace function public.bos_can_see_task(p_task uuid)
returns boolean
language sql
security definer          -- reads tasks/dependencies without re-entering RLS
stable
set search_path = public
as $$
  select
    public.is_admin()
    or exists (select 1 from public.tasks t
                where t.id = p_task and t.owner_id = auth.uid())
    -- what one of mine waits on, via the critical path
    or exists (select 1 from public.tasks m
                where m.owner_id = auth.uid() and m.dependency_id = p_task)
    -- what one of mine waits on, via the dependency graph
    or exists (select 1 from public.dependencies d
                 join public.tasks m on m.id = d.from_id
                where m.owner_id = auth.uid() and d.to_id = p_task)
    -- and what waits on one of mine, so "Blocks" is not blank
    or exists (select 1 from public.tasks t
                where t.id = p_task
                  and t.dependency_id in (select id from public.tasks
                                           where owner_id = auth.uid()))
    or exists (select 1 from public.dependencies d
                 join public.tasks m on m.id = d.to_id
                where m.owner_id = auth.uid() and d.from_id = p_task);
$$;

-- ------------------------------------------------------------
-- May the caller see this goal?
-- ------------------------------------------------------------
-- Theirs, or one their work hangs off. A task without its goal has no context.
create or replace function public.bos_can_see_goal(p_goal uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    public.is_admin()
    or exists (select 1 from public.goals g
                where g.id = p_goal and g.owner_id = auth.uid())
    or exists (select 1 from public.tasks t
                where t.goal_id = p_goal and t.owner_id = auth.uid());
$$;

revoke all on function public.bos_can_see_task(uuid) from public;
revoke all on function public.bos_can_see_goal(uuid) from public;
grant execute on function public.bos_can_see_task(uuid) to authenticated;
grant execute on function public.bos_can_see_goal(uuid) to authenticated;

-- ------------------------------------------------------------
-- Narrow the reads
-- ------------------------------------------------------------
drop policy if exists "staff read tasks" on public.tasks;
create policy "staff read tasks" on public.tasks
  for select using (public.bos_can_see_task(id));

drop policy if exists "staff read goals" on public.goals;
create policy "staff read goals" on public.goals
  for select using (public.bos_can_see_goal(id));

-- Dependencies carry no owner; an edge is visible when either end is.
alter table public.dependencies enable row level security;
drop policy if exists "admin manage dependencies" on public.dependencies;
create policy "admin manage dependencies" on public.dependencies
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "staff read dependencies" on public.dependencies;
create policy "staff read dependencies" on public.dependencies
  for select using (
    public.bos_can_see_task(from_id) or public.bos_can_see_task(to_id)
  );

-- An owner may add or clear a blocker on their own task, which the task
-- panel needs now that employees can edit what they own.
drop policy if exists "owner manage own dependency" on public.dependencies;
create policy "owner manage own dependency" on public.dependencies
  for insert with check (
    public.is_admin()
    or exists (select 1 from public.tasks t
                where t.id = from_id and t.owner_id = auth.uid())
  );

drop policy if exists "owner delete own dependency" on public.dependencies;
create policy "owner delete own dependency" on public.dependencies
  for delete using (
    public.is_admin()
    or exists (select 1 from public.tasks t
                where t.id = from_id and t.owner_id = auth.uid())
  );

-- Task reviews follow their task.
drop policy if exists "staff read task reviews" on public.task_reviews;
create policy "staff read task reviews" on public.task_reviews
  for select using (public.bos_can_see_task(task_id));
