-- ============================================================
-- Tell people what happened to their work.
--
-- Two moments matter to whoever did the task, and until now neither reached
-- them: an admin deciding on the approval, and an admin writing the review.
-- Both are recorded in tables the employee can read, but nothing put it in
-- front of them, so they had to go looking.
--
-- Both hang off the notifications table and the notify helper that already
-- carry host decisions and approval outcomes, so these land in the same bell
-- as everything else.
--
-- Nobody is notified about their own action. An admin reviewing their own
-- task does not need telling.
--
-- Idempotent. Run AFTER 0020. Safe to run twice.
-- ============================================================

-- ------------------------------------------------------------
-- The review is written
-- ------------------------------------------------------------
create or replace function public.bos_notify_task_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_owner uuid;
  v_label text;
  v_body  text;
begin
  -- Only when it lands on a real outcome, and only when that is a change.
  if new.outcome = 'pending' or new.outcome is not distinct from old.outcome then
    return new;
  end if;

  select t.owner_id, coalesce(t.code || ' ', '') || t.title
    into v_owner, v_label
    from public.tasks t
   where t.id = new.task_id;

  if v_owner is null or v_owner = auth.uid() then
    return new;
  end if;

  v_body := case new.outcome
              when 'met'     then 'Reviewed as met.'
              when 'partial' then 'Reviewed as partially met.'
              when 'missed'  then 'Reviewed as missed.'
              else 'An outcome was recorded.'
            end;

  if new.quality is not null then
    v_body := v_body || ' Quality ' || new.quality || ' of 5.';
  end if;
  if nullif(trim(coalesce(new.learning, '')), '') is not null then
    v_body := v_body || ' Learning: ' || new.learning;
  end if;

  perform public.notify(
    v_owner, 'review', 'Your work was reviewed: ' || v_label, v_body, '/admin/os/reviews?tab=tasks'
  );
  return new;
end;
$fn$;

drop trigger if exists trg_bos_notify_task_review on public.task_reviews;
create trigger trg_bos_notify_task_review
  after update on public.task_reviews
  for each row execute function public.bos_notify_task_review();

-- ------------------------------------------------------------
-- The approval is decided
-- ------------------------------------------------------------
create or replace function public.bos_notify_task_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_label text;
begin
  if new.approval_state is not distinct from old.approval_state then
    return new;
  end if;
  if new.approval_state not in ('approved', 'rejected') then
    return new;
  end if;
  if new.owner_id is null or new.owner_id = auth.uid() then
    return new;
  end if;

  v_label := coalesce(new.code || ' ', '') || new.title;

  if new.approval_state = 'approved' then
    perform public.notify(
      new.owner_id, 'task', 'Approved: ' || v_label,
      'Your work was approved and the task is now complete.', '/admin/os/tasks'
    );
  else
    perform public.notify(
      new.owner_id, 'task', 'Sent back: ' || v_label,
      coalesce(nullif(trim(coalesce(new.decision_note, '')), ''), 'This needs another look.'),
      '/admin/os/tasks'
    );
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_bos_notify_task_decision on public.tasks;
create trigger trg_bos_notify_task_decision
  after update on public.tasks
  for each row execute function public.bos_notify_task_decision();
