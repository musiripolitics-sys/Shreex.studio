-- ============================================================
-- 0058 -- Pulling a story into the sprint.
--
-- Found by an end-to-end walk rather than a unit test: the "Pull in" button on
-- the sprint page called a plain update on tasks, and the policies are
--
--     ALL     admin manage tasks        is_admin()
--     UPDATE  owner update own task     owner_id = auth.uid()
--
-- so an employee could only pull in a story they already owned — and a backlog
-- item usually has no owner at all. The button did nothing, said nothing, and
-- the row count came back zero. Refinement is the team deciding what the week
-- contains; it is not an edit of somebody's task.
--
-- A definer function rather than a wider policy: widening "owner update own
-- task" to any staff member would let an employee change a colleague's
-- estimate, status and due date, which is a much larger grant than moving a
-- story between the backlog and this week.
--
-- Idempotent. Safe to run twice.
-- ============================================================

create or replace function public.bos_set_task_sprint(p_task uuid, p_sprint uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_tenant uuid := public.bos_request_tenant();
  v_task   uuid;
begin
  if not public.bos_is_staff() then raise exception 'FORBIDDEN'; end if;
  if v_tenant is null then raise exception 'NO_TENANT'; end if;

  -- The task must be this business's. Checked rather than trusted: the caller
  -- names the id, and a definer function is exactly where a named id stops
  -- being checked by a policy.
  select id into v_task from public.tasks
   where id = p_task and tenant_id = v_tenant;
  if v_task is null then raise exception 'NO_SUCH_TASK'; end if;

  -- Null is the backlog, which is a real destination.
  if p_sprint is not null
     and not exists (select 1 from public.sprints
                      where id = p_sprint and tenant_id = v_tenant) then
    raise exception 'NO_SUCH_SPRINT';
  end if;

  update public.tasks set sprint_id = p_sprint, updated_at = now()
   where id = p_task and tenant_id = v_tenant;
end $fn$;

comment on function public.bos_set_task_sprint(uuid, uuid) is
  $c$Move a story between the backlog and a sprint. Staff of the business, because refinement is the team deciding what the week contains rather than an edit of somebody else task -- widening the owner-update policy instead would have handed every employee their colleagues estimates, statuses and due dates. Both ids are checked against the request tenant, which is the check a policy would have done and a definer function skips.$c$;

revoke all on function public.bos_set_task_sprint(uuid, uuid) from public, anon;
grant execute on function public.bos_set_task_sprint(uuid, uuid) to authenticated;
