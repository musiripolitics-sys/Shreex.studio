-- ============================================================
-- 0056 -- One-week sprints, and the numbers that come out of them.
--
-- The roadmap was a 90-day timeline. Shreex runs on agile, so the unit of work
-- is a sprint: Monday to Sunday, every product feeding the same one, estimated
-- and measured in hours.
--
-- What the research says, recorded here because it shapes what gets measured:
-- ceremony overhead on a ONE-week sprint runs 20-25% of the sprint, and it
-- breaks down when work items are large. So this schema makes a large unstarted
-- story visible rather than letting it sit. And the warning that matters more:
-- most teams track velocity because it is easy to calculate, not because it
-- decides anything, and velocity rising while quality falls is worse than no
-- metric at all. So bos_sprint_metrics returns carry-over and overrun beside
-- the throughput numbers -- an output number with nothing to check it against
-- rewards speed over value.
--
-- Hours rather than points, by choice: estimate_hours and actual_hours already
-- exist on tasks, so estimate-versus-actual accuracy comes free.
--
-- Idempotent. Safe to run twice.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The sprint
--
-- Monday-anchored. date_trunc('week') in Postgres is ISO, so it lands on
-- Monday without a calendar table, and ends_on is derived rather than stored
-- twice -- a sprint whose two dates disagree is a bug waiting to be argued
-- about.
-- ------------------------------------------------------------
create table if not exists public.sprints (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null default public.bos_tenant_default()
               references public.tenants(id) on delete restrict,
  number     int  not null,
  starts_on  date not null,
  ends_on    date generated always as (starts_on + 6) stored,
  goal       text,
  status     text not null default 'planned'
               check (status in ('planned', 'active', 'closed')),
  -- Recorded at close, because they are facts about what happened rather than
  -- a query that would change meaning as tasks move afterwards.
  carried_out int,
  closed_at  timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, number),
  unique (tenant_id, starts_on),
  constraint sprints_starts_monday check (extract(isodow from starts_on) = 1)
);

comment on table public.sprints is
  $c$One week of work, Monday to Sunday, for one business. Every product feeds the same sprint: an events task, a finance task and a marketing task all sit in this week together, which is the only way the week has one honest answer to what was committed.$c$;
comment on column public.sprints.ends_on is
  $c$Derived, not stored twice. A sprint whose start and end disagree is an argument nobody can settle.$c$;
comment on column public.sprints.carried_out is
  $c$How many stories left this sprint unfinished, recorded AT CLOSE. Computing it later would give a different answer as those tasks move on, and the number that matters is what was true when the week ended.$c$;

create index if not exists sprints_tenant_idx on public.sprints(tenant_id, starts_on desc);
-- At most one sprint is active per business.
create unique index if not exists sprints_one_active_idx
  on public.sprints(tenant_id) where status = 'active';

alter table public.sprints enable row level security;

drop policy if exists "tenant isolation" on public.sprints;
create policy "tenant isolation" on public.sprints
  as restrictive for all to authenticated, anon
  using (tenant_id = public.bos_request_tenant())
  with check (tenant_id = public.bos_request_tenant());

drop policy if exists "staff read sprints" on public.sprints;
create policy "staff read sprints" on public.sprints
  for select using (public.bos_is_staff());

drop policy if exists "admin writes sprints" on public.sprints;
create policy "admin writes sprints" on public.sprints
  for all using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.sprints to authenticated;
revoke all on public.sprints from anon;

drop trigger if exists trg_sprints_touch on public.sprints;
create trigger trg_sprints_touch before update on public.sprints
  for each row execute function public.bos_touch_row();

-- ------------------------------------------------------------
-- 2. Work belongs to a sprint
--
-- Nullable on purpose: no sprint IS the backlog, and a backlog you cannot
-- express is a backlog people keep in their heads.
-- ------------------------------------------------------------
alter table public.tasks
  add column if not exists sprint_id uuid references public.sprints(id) on delete set null;

comment on column public.tasks.sprint_id is
  $c$The sprint this story is committed to. Null is the backlog, which is a real state and not a missing value.$c$;

create index if not exists tasks_sprint_idx on public.tasks(sprint_id) where sprint_id is not null;

-- A story cannot be committed to another business's sprint. Same composite
-- shape as the 66 foreign keys 0049 added, and for the same reason.
do $mig$
begin
  if not exists (select 1 from pg_constraint where conname = 'sprints_tenant_id_id_key') then
    alter table public.sprints add constraint sprints_tenant_id_id_key unique (tenant_id, id);
  end if;
end $mig$;

-- Now the stories can point at it. A story cannot be committed to another
-- business's sprint: same composite shape as the 66 foreign keys 0049 added.
do $mig$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_tenant_sprint_fkey') then
    alter table public.tasks
      add constraint tasks_tenant_sprint_fkey
      foreign key (tenant_id, sprint_id) references public.sprints (tenant_id, id)
      on delete set null (sprint_id);
  end if;
  -- The narrow key the column declaration created is now redundant, and
  -- redundant is the wrong word for it: it permits exactly the cross-tenant
  -- reference the composite one exists to refuse.
  alter table public.tasks drop constraint if exists tasks_sprint_id_fkey;
end $mig$;

-- ------------------------------------------------------------
-- 3. The ceremonies, as records rather than calendar invitations
--
-- Refinement on Monday, review and retrospective at the end. Stored as notes
-- against the sprint, because the value of a retro is what was decided, and a
-- decision nobody wrote down did not happen.
-- ------------------------------------------------------------
create table if not exists public.sprint_notes (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null default public.bos_tenant_default()
               references public.tenants(id) on delete restrict,
  sprint_id  uuid not null references public.sprints(id) on delete cascade,
  kind       text not null check (kind in ('refinement', 'review', 'retro_good', 'retro_bad', 'retro_action')),
  body       text not null,
  author_id  uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.sprint_notes is
  $c$What was said at the ceremonies. retro_action is the one that earns its keep: a retrospective that produces no action is a meeting, and splitting it from retro_good and retro_bad is what makes "did we do anything about it" answerable next week.$c$;

create index if not exists sprint_notes_sprint_idx on public.sprint_notes(sprint_id, kind);

alter table public.sprint_notes enable row level security;

drop policy if exists "tenant isolation" on public.sprint_notes;
create policy "tenant isolation" on public.sprint_notes
  as restrictive for all to authenticated, anon
  using (tenant_id = public.bos_request_tenant())
  with check (tenant_id = public.bos_request_tenant());

drop policy if exists "staff manage sprint notes" on public.sprint_notes;
create policy "staff manage sprint notes" on public.sprint_notes
  for all using (public.bos_is_staff()) with check (public.bos_is_staff());

grant select, insert, update, delete on public.sprint_notes to authenticated;
revoke all on public.sprint_notes from anon;

do $mig$
begin
  if not exists (select 1 from pg_constraint where conname = 'sprint_notes_tenant_sprint_fkey') then
    alter table public.sprint_notes
      add constraint sprint_notes_tenant_sprint_fkey
      foreign key (tenant_id, sprint_id) references public.sprints (tenant_id, id)
      on delete cascade;
  end if;
  alter table public.sprint_notes drop constraint if exists sprint_notes_sprint_id_fkey;
end $mig$;

-- ------------------------------------------------------------
-- 4. Which sprint a date belongs to, and making sure it exists
-- ------------------------------------------------------------
create or replace function public.bos_sprint_monday(p_date date default current_date)
returns date
language sql
immutable
as $fn$ select (date_trunc('week', p_date::timestamp))::date $fn$;

comment on function public.bos_sprint_monday(date) is
  $c$The Monday of the week a date falls in. date_trunc week is ISO in Postgres, so this needs no calendar table and no locale assumption.$c$;

grant execute on function public.bos_sprint_monday(date) to authenticated;

create or replace function public.bos_ensure_sprint(p_date date default current_date)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_tenant uuid := public.bos_request_tenant();
  v_monday date := public.bos_sprint_monday(p_date);
  v_id     uuid;
  v_num    int;
begin
  if not public.bos_is_staff() then raise exception 'FORBIDDEN'; end if;
  if v_tenant is null then raise exception 'NO_TENANT'; end if;

  select id into v_id from public.sprints
   where tenant_id = v_tenant and starts_on = v_monday;
  if v_id is not null then return v_id; end if;

  -- Numbered per business, continuing from whatever exists rather than from a
  -- count, so deleting an old sprint does not renumber the live ones.
  select coalesce(max(number), 0) + 1 into v_num
    from public.sprints where tenant_id = v_tenant;

  insert into public.sprints (tenant_id, number, starts_on,
                              status)
  values (v_tenant, v_num, v_monday,
          case when v_monday = public.bos_sprint_monday(current_date)
               then 'active' else 'planned' end)
  returning id into v_id;

  return v_id;
end $fn$;

comment on function public.bos_ensure_sprint(date) is
  $c$The sprint covering a date, created if it does not exist. The week that contains today is created active; any other week is planned. Idempotent per business per week, which the unique index on (tenant_id, starts_on) enforces rather than trusts.$c$;

revoke all on function public.bos_ensure_sprint(date) from public, anon;
grant execute on function public.bos_ensure_sprint(date) to authenticated;

create or replace function public.bos_current_sprint()
returns uuid
language sql
stable
security definer
set search_path = public
as $fn$
  select id from public.sprints
   where tenant_id = public.bos_request_tenant()
     and starts_on = public.bos_sprint_monday(current_date)
   limit 1;
$fn$;

comment on function public.bos_current_sprint() is
  $c$This week sprint for the business this request is about, or null if nobody has started one. Null is a real answer: a business that has not planned the week has not planned the week.$c$;

revoke all on function public.bos_current_sprint() from public, anon;
grant execute on function public.bos_current_sprint() to authenticated;

-- ------------------------------------------------------------
-- 5. The numbers
--
-- Deliberately not just velocity. An output number with nothing to check it
-- against rewards speed over value, which is the failure mode the research is
-- loudest about -- so committed hours arrive beside carry-over, overrun and
-- the count of unestimated stories, and each one is a different decision.
-- ------------------------------------------------------------
create or replace function public.bos_sprint_metrics(p_sprint uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_tenant uuid := public.bos_request_tenant();
  v_id     uuid := coalesce(p_sprint, public.bos_current_sprint());
  v_s      public.sprints;
  r        jsonb;
begin
  if not public.bos_is_staff() then return '{}'::jsonb; end if;
  if v_id is null then return jsonb_build_object('sprint', null); end if;

  select * into v_s from public.sprints where id = v_id and tenant_id = v_tenant;
  if not found then return jsonb_build_object('sprint', null); end if;

  select jsonb_build_object(
    'sprint',        v_s.id,
    'number',        v_s.number,
    'goal',          v_s.goal,
    'status',        v_s.status,
    'starts_on',     v_s.starts_on,
    'ends_on',       v_s.ends_on,
    -- Day 1 is Monday. Past the end it saturates at 7 rather than growing,
    -- because "day 23 of 7" helps nobody.
    'day',           least(greatest((current_date - v_s.starts_on) + 1, 0), 7),
    'stories',       count(*),
    'done',          count(*) filter (where t.status = 'completed'),
    'in_progress',   count(*) filter (where t.status = 'in_progress'),
    'not_started',   count(*) filter (where t.status = 'not_started'),
    'blocked',       count(*) filter (where t.status = 'blocked'),
    'committed_hours', coalesce(sum(t.estimate_hours), 0),
    'done_hours',    coalesce(sum(t.estimate_hours) filter (where t.status = 'completed'), 0),
    'actual_hours',  coalesce(sum(t.actual_hours), 0),
    -- The two that keep velocity honest.
    'unestimated',   count(*) filter (where t.estimate_hours is null and t.status <> 'cancelled'),
    'overrun_hours', coalesce(sum(greatest(coalesce(t.actual_hours,0) - coalesce(t.estimate_hours,0), 0))
                              filter (where t.status = 'completed'), 0),
    'overdue',       count(*) filter (where t.due_date < current_date
                                        and t.status not in ('completed','cancelled'))
  ) into r
  from public.tasks t
  where t.sprint_id = v_id and t.tenant_id = v_tenant;

  return r || jsonb_build_object('carried_out', v_s.carried_out);
end $fn$;

comment on function public.bos_sprint_metrics(uuid) is
  $c$One sprint, in numbers. Throughput arrives with carry-over, overrun and unestimated beside it on purpose: velocity on its own rewards speed over value, and most teams track it because it is easy to calculate rather than because it decides anything.$c$;

revoke all on function public.bos_sprint_metrics(uuid) from public, anon;
grant execute on function public.bos_sprint_metrics(uuid) to authenticated;

-- ------------------------------------------------------------
-- 6. Velocity, which only means something across several sprints
-- ------------------------------------------------------------
create or replace function public.bos_sprint_history(p_limit int default 8)
returns table(id uuid, number int, starts_on date, status text,
              stories bigint, done bigint, committed_hours numeric,
              done_hours numeric, actual_hours numeric, carried_out int)
language sql
stable
security definer
set search_path = public
as $fn$
  select s.id, s.number, s.starts_on, s.status,
         count(t.id),
         count(t.id) filter (where t.status = 'completed'),
         coalesce(sum(t.estimate_hours), 0),
         coalesce(sum(t.estimate_hours) filter (where t.status = 'completed'), 0),
         coalesce(sum(t.actual_hours), 0),
         s.carried_out
    from public.sprints s
    left join public.tasks t on t.sprint_id = s.id and t.tenant_id = s.tenant_id
   where s.tenant_id = public.bos_request_tenant()
     and public.bos_is_staff()
   group by s.id
   order by s.starts_on desc
   limit greatest(coalesce(p_limit, 8), 1);
$fn$;

comment on function public.bos_sprint_history(int) is
  $c$The last few sprints, for the trend. A single sprint velocity is noise; the shape across several is the only thing worth acting on.$c$;

revoke all on function public.bos_sprint_history(int) from public, anon;
grant execute on function public.bos_sprint_history(int) to authenticated;

-- ------------------------------------------------------------
-- 7. Closing the week
--
-- Everything unfinished moves to the next sprint and the count is recorded.
-- Carry-over is the number that tells you whether the week was planned
-- honestly, so it has to survive the stories moving on.
-- ------------------------------------------------------------
create or replace function public.bos_close_sprint(p_sprint uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_tenant uuid := public.bos_request_tenant();
  v_id     uuid := coalesce(p_sprint, public.bos_current_sprint());
  v_s      public.sprints;
  v_next   uuid;
  v_moved  int;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if v_id is null then raise exception 'NO_SPRINT'; end if;

  select * into v_s from public.sprints where id = v_id and tenant_id = v_tenant;
  if not found then raise exception 'NO_SPRINT'; end if;
  if v_s.status = 'closed' then raise exception 'ALREADY_CLOSED'; end if;

  -- The following week, created if needed. A sprint that cannot be closed
  -- because next week does not exist yet would be a silly place to stop.
  v_next := public.bos_ensure_sprint(v_s.starts_on + 7);

  update public.tasks
     set sprint_id = v_next
   where tenant_id = v_tenant and sprint_id = v_id
     and status not in ('completed', 'cancelled');
  get diagnostics v_moved = row_count;

  update public.sprints
     set status = 'closed', closed_at = now(), carried_out = v_moved
   where id = v_id;

  update public.sprints set status = 'active'
   where id = v_next and starts_on = public.bos_sprint_monday(current_date);

  insert into public.audit_log (user_id, action, entity, entity_id, before, after, tenant_id)
  values (auth.uid(), 'close', 'sprints', v_id, null,
          jsonb_build_object('carried_out', v_moved, 'into', v_next), v_tenant);

  return jsonb_build_object('closed', v_id, 'next', v_next, 'carried_out', v_moved);
end $fn$;

comment on function public.bos_close_sprint(uuid) is
  $c$Close the week: everything unfinished moves to the next sprint and the count is recorded on the sprint that just ended. Recorded rather than derived, because once those stories move the question "how much did we carry" would start giving a different answer every time it was asked.$c$;

revoke all on function public.bos_close_sprint(uuid) from public, anon;
grant execute on function public.bos_close_sprint(uuid) to authenticated;
