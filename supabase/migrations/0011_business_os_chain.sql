-- ============================================================
-- Techxfluence Business OS — the roadmap → task → calendar → review chain.
--
--   1. tasks gain a time estimate, actual hours and a completion stamp, so
--      "how long did we think vs how long did it take" is answerable.
--   2. task_reviews: one review per task, opened automatically the moment a
--      task is marked completed. The weekly/monthly `reviews` table stays as
--      the period retro; this is the per-item one.
--   3. bos_sync_roadmap_tasks(): every roadmap goal becomes a task, so the
--      goal's dates land on the calendar as work rather than as a heading.
--   4. bos_section_status(): one round trip that tells the dashboard how many
--      records each OS section holds and how many of them are overdue.
--
-- Idempotent. Run AFTER 0007–0010.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Time tracking on tasks
-- ------------------------------------------------------------
alter table public.tasks add column if not exists estimate_hours numeric;
alter table public.tasks add column if not exists actual_hours   numeric;
alter table public.tasks add column if not exists completed_at   timestamptz;

comment on column public.tasks.estimate_hours is 'Estimated hours of work, set when the task is planned.';
comment on column public.tasks.actual_hours   is 'Hours actually spent, captured at review time.';
comment on column public.tasks.completed_at   is 'Stamped by trigger when status first becomes completed.';

-- Backfill: anything already completed gets its last-updated time as the
-- completion stamp. It is the best evidence we have retroactively.
update public.tasks
   set completed_at = updated_at
 where status = 'completed' and completed_at is null;

create or replace function public.bos_stamp_task_completion()
returns trigger language plpgsql as $$
begin
  if new.status = 'completed' and coalesce(old.status, 'not_started') <> 'completed' then
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.status <> 'completed' then
    new.completed_at := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_tasks_completion on public.tasks;
create trigger trg_tasks_completion before insert or update of status on public.tasks
  for each row execute function public.bos_stamp_task_completion();

-- ------------------------------------------------------------
-- 2. One review per task
-- ------------------------------------------------------------
create table if not exists public.task_reviews (
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid not null unique references public.tasks(id) on delete cascade,
  outcome        text not null default 'pending'
                   check (outcome in ('pending','met','partial','missed')),
  estimate_hours numeric,   -- snapshot of the estimate at completion time
  actual_hours   numeric,
  variance_hours numeric generated always as (actual_hours - estimate_hours) stored,
  quality        smallint check (quality between 1 and 5),
  what_worked    text,
  what_failed    text,
  learning       text,
  reviewed_by    uuid references public.users(id) on delete set null,
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists task_reviews_outcome_idx on public.task_reviews(outcome);

drop trigger if exists trg_task_reviews_updated on public.task_reviews;
create trigger trg_task_reviews_updated before update on public.task_reviews
  for each row execute function public.set_updated_at();

alter table public.task_reviews enable row level security;
drop policy if exists "admin manage task reviews" on public.task_reviews;
create policy "admin manage task reviews" on public.task_reviews
  for all using (public.is_admin()) with check (public.is_admin());

-- Completing a task opens its review, pre-filled with the estimate. It stays
-- `pending` until somebody fills it in — which is what makes it show up as
-- outstanding work on the dashboard.
create or replace function public.bos_open_task_review()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and coalesce(old.status, 'not_started') <> 'completed' then
    insert into public.task_reviews (task_id, estimate_hours, actual_hours)
    values (new.id, new.estimate_hours, new.actual_hours)
    on conflict (task_id) do update
      set estimate_hours = coalesce(public.task_reviews.estimate_hours, excluded.estimate_hours);
  end if;
  return new;
end $$;

drop trigger if exists trg_tasks_open_review on public.tasks;
create trigger trg_tasks_open_review after insert or update of status on public.tasks
  for each row execute function public.bos_open_task_review();

-- Backfill reviews for tasks that were completed before this migration.
insert into public.task_reviews (task_id, estimate_hours, actual_hours)
select t.id, t.estimate_hours, t.actual_hours
  from public.tasks t
 where t.status = 'completed'
on conflict (task_id) do nothing;

-- ------------------------------------------------------------
-- 3. Roadmap goals become tasks
-- ------------------------------------------------------------
-- Each roadmap line is a unit of work. This creates the task for any goal that
-- does not have one yet, carrying the goal's owner, workstream, dates and
-- priority across, and mirroring the goal's dependency onto the task. Safe to
-- run repeatedly: it never touches a goal that already produced a task.
create or replace function public.bos_sync_roadmap_tasks()
returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;

  with created as (
    insert into public.tasks
      (goal_id, workstream_id, title, description, owner_id,
       start_date, due_date, priority, status)
    select g.id,
           g.workstream_id,
           coalesce(nullif(trim(g.deliverable), ''), g.objective, 'Untitled goal'),
           case when nullif(trim(g.deliverable), '') is not null then g.objective end,
           g.owner_id,
           g.start_date,
           g.end_date,
           g.priority,
           g.status
      from public.goals g
     where not exists (select 1 from public.tasks t where t.goal_id = g.id)
    returning id, goal_id
  )
  select count(*) into v_count from created;

  -- Mirror goal-to-goal dependencies onto the tasks they produced.
  update public.tasks t
     set dependency_id = dep.id
    from public.goals g
    join public.tasks dep on dep.goal_id = g.dependency_id
   where t.goal_id = g.id
     and g.dependency_id is not null
     and t.dependency_id is null;

  return v_count;
end $$;

revoke all on function public.bos_sync_roadmap_tasks() from public;
grant execute on function public.bos_sync_roadmap_tasks() to authenticated;

-- ------------------------------------------------------------
-- 4. Section status for the dashboard
-- ------------------------------------------------------------
-- Returns { section_key: { total, open, overdue } } for every OS section, in
-- one round trip. Tables that do not exist yet are skipped rather than
-- erroring, so a partially-migrated database still renders.
create or replace function public.bos_section_status()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r        record;
  v_out    jsonb := '{}'::jsonb;
  v_total  int;
  v_open   int;
  v_over   int;
  -- Status vocabularies differ per table (enums and free text), so everything
  -- is compared as text against one "this is finished" set.
  v_done   constant text :=
    '''completed'',''cancelled'',''done'',''closed'',''published'',''archived'','
    || '''resolved'',''filled'',''won'',''lost'',''rejected'',''inactive'',''retired''';
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;

  for r in
    select * from (values
      -- key,            table,               date column,      status column
      ('roadmap',        'goals',             'end_date',       'status'),
      ('tasks',          'tasks',             'due_date',       'status'),
      ('dependencies',   'dependencies',      null,             'status'),
      ('reviews',        'reviews',           null,             null),
      ('task_reviews',   'task_reviews',      null,             'outcome'),
      ('events',         'events',            null,             null),
      ('finance',        'revenue_entries',   null,             null),
      ('expenses',       'expenses',          null,             null),
      ('cashflow',       'cashflow_months',   null,             null),
      ('membership',     'memberships',       null,             null),
      ('campaigns',      'campaigns',         'end_date',       'status'),
      ('content',        'content_items',     'content_date',   'status'),
      ('podcast',        'podcast_episodes',  'recording_date', 'publishing_status'),
      ('crm',            'leads',             'next_follow_up', 'stage'),
      ('partnerships',   'partnerships',      'end_date',       'status'),
      ('influencers',    'influencers',       null,             'status'),
      ('ambassadors',    'ambassadors',       null,             'status'),
      ('people',         'employee_profiles', null,             'status'),
      ('hiring',         'hiring_plan',       'start_date',     'status'),
      ('empkpis',        'employee_kpis',     null,             null),
      ('product',        'app_modules',       'target_date',    'status'),
      ('approvals',      'approvals',         null,             'decision'),
      ('risks',          'risks',             'due_date',       'status'),
      ('legal',          'legal_items',       'due_date',       'status'),
      ('sops',           'sops',              'next_review',    'status'),
      ('vendors',        'vendors',           'end_date',       'status'),
      ('assets',         'assets',            'review_date',    'status'),
      ('inventory',      'inventory',         null,             'status'),
      ('competitors',    'competitors',       'review_date',    null),
      ('feedback',       'feedback',          null,             null),
      ('kpis',           'kpis',              null,             null),
      ('audit',          'audit_log',         null,             null)
    ) as t(key, tbl, date_col, status_col)
  loop
    if to_regclass('public.' || r.tbl) is null then
      continue;
    end if;

    execute format('select count(*) from public.%I', r.tbl) into v_total;

    -- "Open" only means something where there is a status to read.
    if r.status_col is not null then
      execute format(
        'select count(*) from public.%I where %I::text not in (%s)',
        r.tbl, r.status_col, v_done
      ) into v_open;
    else
      v_open := null;
    end if;

    -- Overdue needs both a date in the past and something left to do.
    if r.date_col is not null then
      if r.status_col is not null then
        execute format(
          'select count(*) from public.%I where %I < current_date and %I::text not in (%s)',
          r.tbl, r.date_col, r.status_col, v_done
        ) into v_over;
      else
        execute format(
          'select count(*) from public.%I where %I < current_date',
          r.tbl, r.date_col
        ) into v_over;
      end if;
    else
      v_over := 0;
    end if;

    v_out := v_out || jsonb_build_object(
      r.key, jsonb_build_object('total', v_total, 'open', v_open, 'overdue', v_over)
    );
  end loop;

  -- Reviews waiting to be written are outstanding work, not just a row count.
  if to_regclass('public.task_reviews') is not null then
    select count(*) into v_over from public.task_reviews where outcome = 'pending';
    v_out := jsonb_set(v_out, '{task_reviews,overdue}', to_jsonb(v_over));
  end if;

  return v_out;
end $$;

revoke all on function public.bos_section_status() from public;
grant execute on function public.bos_section_status() to authenticated;
