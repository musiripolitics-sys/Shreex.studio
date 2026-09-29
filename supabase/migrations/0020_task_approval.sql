-- ============================================================
-- A task is not finished because the person doing it says so.
--
-- Three rules, enforced here rather than in the pages, so they hold through
-- the task panel, the Kanban board, the admin table and a raw PostgREST call
-- alike:
--
--   1. A task with nobody assigned cannot be completed.
--   2. A task with no comment on it cannot be completed. The thread is the
--      record of what was actually done.
--   3. Someone who is not an admin cannot complete their own work. They
--      submit it, and an admin approves. Approving is what completes it.
--
-- An admin completing a task IS the approval, so they are not made to file a
-- request with themselves. Rules 1 and 2 still apply to them.
--
-- Idempotent. Run AFTER 0019. Safe to run twice.
-- ============================================================

do $mig$ begin
  create type public.task_approval as enum ('none', 'pending', 'approved', 'rejected');
exception when duplicate_object then null; end $mig$;

alter table public.tasks
  add column if not exists approval_state public.task_approval not null default 'none',
  add column if not exists submitted_at   timestamptz,
  add column if not exists submitted_by   uuid references public.users(id) on delete set null,
  add column if not exists decided_at     timestamptz,
  add column if not exists decided_by     uuid references public.users(id) on delete set null,
  add column if not exists decision_note  text;

create index if not exists idx_tasks_approval on public.tasks(approval_state);

-- Work already finished before this existed is treated as approved, or the
-- next edit of any old task would be refused.
update public.tasks
   set approval_state = 'approved'
 where status = 'completed' and approval_state = 'none';

-- ------------------------------------------------------------
-- Why this task cannot be completed yet, in words, or null when it can.
-- The panel shows this; the trigger below enforces it.
-- ------------------------------------------------------------
create or replace function public.bos_task_completion_block(p_task uuid)
returns text
language sql
security definer
stable
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
 where t.id = p_task;
$fn$;

revoke all on function public.bos_task_completion_block(uuid) from public;
grant execute on function public.bos_task_completion_block(uuid) to authenticated;

-- ------------------------------------------------------------
-- The gate
-- ------------------------------------------------------------
create or replace function public.bos_guard_task_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_admin boolean := public.is_admin();
begin
  -- Nobody but an admin may hand themselves an approval. Everyone else may
  -- only put a task up for one, and only from a state that has not been
  -- decided yet.
  if new.approval_state is distinct from old.approval_state and not v_admin then
    if new.approval_state <> 'pending' then
      raise exception 'Only an admin can approve or reject a task.'
        using errcode = 'check_violation';
    end if;
    if old.approval_state not in ('none', 'rejected') then
      raise exception 'This task has already been submitted.'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.approval_state = 'pending' and old.approval_state is distinct from 'pending' then
    if new.owner_id is null then
      raise exception 'Assign this task to someone before submitting it.'
        using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.task_comments c where c.task_id = new.id) then
      raise exception 'Leave a comment saying what was done before submitting it.'
        using errcode = 'check_violation';
    end if;
    new.submitted_at := now();
    new.submitted_by := auth.uid();
  end if;

  if new.status = 'completed' and old.status is distinct from 'completed' then
    if new.owner_id is null then
      raise exception 'Assign this task to someone before completing it.'
        using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.task_comments c where c.task_id = new.id) then
      raise exception 'Leave a comment saying what was done before completing it.'
        using errcode = 'check_violation';
    end if;

    if v_admin then
      -- The admin closing it is the approval. No request to file.
      if new.approval_state <> 'approved' then
        new.approval_state := 'approved';
        new.decided_at     := now();
        new.decided_by     := auth.uid();
      end if;
    elsif new.approval_state <> 'approved' then
      raise exception 'An admin has to approve this before it can be completed.'
        using errcode = 'check_violation';
    end if;
  end if;

  -- A rejection sends the work back; it cannot stay completed.
  if new.approval_state = 'rejected' and new.status = 'completed' then
    new.status := 'in_progress';
  end if;

  if new.approval_state in ('approved', 'rejected')
     and old.approval_state is distinct from new.approval_state then
    new.decided_at := now();
    new.decided_by := auth.uid();
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_bos_guard_task_completion on public.tasks;
create trigger trg_bos_guard_task_completion
  before update on public.tasks
  for each row execute function public.bos_guard_task_completion();

-- ------------------------------------------------------------
-- Keep the approvals inbox in step
-- ------------------------------------------------------------
create or replace function public.bos_sync_task_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.approval_state = 'pending' and old.approval_state is distinct from 'pending' then
    delete from public.approvals
     where related_type = 'task' and related_id = new.id and decision = 'pending';
    insert into public.approvals (request_type, request_title, requester_id, decision, related_type, related_id)
    values ('Task', coalesce(new.code || ' ', '') || new.title, new.submitted_by, 'pending', 'task', new.id);

  elsif new.approval_state in ('approved', 'rejected')
        and old.approval_state is distinct from new.approval_state then
    update public.approvals
       set decision   = new.approval_state::text::approval_decision,
           approver_id = new.decided_by,
           decided_at = now(),
           comments   = new.decision_note
     where related_type = 'task' and related_id = new.id and decision = 'pending';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_bos_sync_task_approval on public.tasks;
create trigger trg_bos_sync_task_approval
  after update on public.tasks
  for each row execute function public.bos_sync_task_approval();
