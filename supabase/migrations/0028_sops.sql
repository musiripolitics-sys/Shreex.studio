-- ============================================================
-- Phase 4: procedures that can be trusted.
--
-- The sops table was one flat row per step: a process name, a step, a quality
-- check. Useful as a list and no use as a procedure, because it cannot answer
-- the four questions that make an SOP worth having. Which version is current.
-- Who approved it. Who has read it. Whether it was actually followed on the
-- day.
--
-- So: a document, versions of it, an approval on each version, an
-- acknowledgement per person per version, and a run — the procedure carried
-- out against a real event, step by step, with evidence.
--
-- The old sops table is left alone. It is still what the registry module
-- reads, and throwing away rows somebody entered would be a poor trade for
-- tidiness.
--
-- Idempotent. Run AFTER 0027.
-- ============================================================

do $mig$ begin
  create type public.sop_state as enum ('draft', 'in_review', 'published', 'retired');
exception when duplicate_object then null; end $mig$;

do $mig$ begin
  create type public.sop_step_state as enum ('pending', 'pass', 'fail', 'na');
exception when duplicate_object then null; end $mig$;

-- ------------------------------------------------------------
-- The document
-- ------------------------------------------------------------
create table if not exists public.sop_documents (
  id                uuid primary key default gen_random_uuid(),
  code              text unique,
  title             text not null,
  purpose           text,
  category          text,
  owner_id          uuid references public.users(id) on delete set null,
  state             public.sop_state not null default 'draft',
  review_every_days int not null default 180,
  next_review       date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_sop_documents_state on public.sop_documents(state);

-- ------------------------------------------------------------
-- Its versions. The body is never edited in place once approved: a change is
-- a new version, which is the only way the acknowledgements below mean
-- anything.
-- ------------------------------------------------------------
create table if not exists public.sop_versions (
  id           uuid primary key default gen_random_uuid(),
  sop_id       uuid not null references public.sop_documents(id) on delete cascade,
  version      int not null,
  body         text,
  change_note  text,
  author_id    uuid references public.users(id) on delete set null,
  approved_by  uuid references public.users(id) on delete set null,
  approved_at  timestamptz,
  created_at   timestamptz not null default now(),
  unique (sop_id, version)
);

create table if not exists public.sop_steps (
  id            uuid primary key default gen_random_uuid(),
  version_id    uuid not null references public.sop_versions(id) on delete cascade,
  sort_order    int not null default 0,
  instruction   text not null,
  pass_criteria text,
  needs_evidence boolean not null default false
);
create index if not exists idx_sop_steps_version on public.sop_steps(version_id, sort_order);

-- ------------------------------------------------------------
-- Who has read which version
-- ------------------------------------------------------------
create table if not exists public.sop_acknowledgements (
  id              uuid primary key default gen_random_uuid(),
  version_id      uuid not null references public.sop_versions(id) on delete cascade,
  user_id         uuid not null references public.users(id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  unique (version_id, user_id)
);

-- ------------------------------------------------------------
-- The procedure actually carried out
-- ------------------------------------------------------------
create table if not exists public.sop_runs (
  id           uuid primary key default gen_random_uuid(),
  sop_id       uuid not null references public.sop_documents(id) on delete cascade,
  version_id   uuid not null references public.sop_versions(id) on delete cascade,
  event_id     uuid references public.events(id) on delete set null,
  label        text,
  run_by       uuid references public.users(id) on delete set null,
  started_at   timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists idx_sop_runs_sop on public.sop_runs(sop_id, started_at desc);

create table if not exists public.sop_run_items (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid not null references public.sop_runs(id) on delete cascade,
  step_id      uuid not null references public.sop_steps(id) on delete cascade,
  state        public.sop_step_state not null default 'pending',
  note         text,
  evidence_url text,
  checked_by   uuid references public.users(id) on delete set null,
  checked_at   timestamptz,
  unique (run_id, step_id)
);

-- ------------------------------------------------------------
-- Access. Everyone who holds Govern can read; changing a procedure is an
-- admin act, because an SOP anybody can rewrite is not a control.
-- ------------------------------------------------------------
do $mig$
declare t text;
begin
  foreach t in array array[
    'sop_documents','sop_versions','sop_steps','sop_acknowledgements','sop_runs','sop_run_items'
  ] loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists "sop staff read %1$s" on public.%1$I', t);
    execute format(
      'create policy "sop staff read %1$s" on public.%1$I for select using (public.bos_is_staff())', t);

    execute format('drop policy if exists "sop admin manage %1$s" on public.%1$I', t);
    execute format(
      'create policy "sop admin manage %1$s" on public.%1$I for all using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $mig$;

-- Reading a procedure and saying you have read it is everybody's job.
drop policy if exists "sop acknowledge own" on public.sop_acknowledgements;
create policy "sop acknowledge own" on public.sop_acknowledgements
  for insert with check (user_id = auth.uid());

-- Carrying one out is too: a run is evidence, not configuration.
drop policy if exists "sop staff run" on public.sop_runs;
create policy "sop staff run" on public.sop_runs
  for insert with check (public.bos_is_staff());

drop policy if exists "sop staff tick" on public.sop_run_items;
create policy "sop staff tick" on public.sop_run_items
  for insert with check (public.bos_is_staff());

drop policy if exists "sop staff tick update" on public.sop_run_items;
create policy "sop staff tick update" on public.sop_run_items
  for update using (public.bos_is_staff()) with check (public.bos_is_staff());

drop policy if exists "sop staff finish run" on public.sop_runs;
create policy "sop staff finish run" on public.sop_runs
  for update using (public.bos_is_staff()) with check (public.bos_is_staff());

-- ------------------------------------------------------------
-- Publishing a version is the approval
-- ------------------------------------------------------------
create or replace function public.bos_publish_sop(p_version uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_sop uuid;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can approve a procedure.' using errcode = 'check_violation';
  end if;

  select sop_id into v_sop from public.sop_versions where id = p_version;
  if v_sop is null then raise exception 'No such version.'; end if;

  update public.sop_versions
     set approved_by = auth.uid(), approved_at = now()
   where id = p_version;

  update public.sop_documents
     set state = 'published',
         updated_at = now(),
         next_review = current_date + make_interval(days => review_every_days)
   where id = v_sop;
end;
$fn$;

revoke all on function public.bos_publish_sop(uuid) from public;
grant execute on function public.bos_publish_sop(uuid) to authenticated;

-- ------------------------------------------------------------
-- The current version of a document: the newest approved one, or the newest
-- draft where nothing has been approved yet.
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
   order by (approved_at is not null) desc, version desc
   limit 1;
$fn$;

grant execute on function public.bos_sop_current(uuid) to authenticated;
