-- ============================================================
-- Govern: who is responsible, and what changed.
--
-- The six areas here — risk and issues, legal, complaints, audit, the data
-- dictionary, assets and inventory — have one thing in common that none of
-- them currently has. You cannot ask a record who owns it and what has
-- happened to it. audit_log catches what the app chooses to write, which is
-- not the same as what actually changed.
--
-- So the spine is one change log and one trigger, attached to every governed
-- table. It records a row per field per change: what it was, what it became,
-- who did it, when. Nothing has to remember to log; the table does it.
--
-- On top of that, three things that did not exist at all: complaints, a data
-- dictionary, and version history for documents and equipment custody.
--
-- Scoped to operational rigour deliberately — owners and history, not
-- approval gates. An approval workflow on a risk register is how risk
-- registers stop being updated.
--
-- Idempotent. Run AFTER 0028.
-- ============================================================

-- ------------------------------------------------------------
-- The spine
-- ------------------------------------------------------------
create table if not exists public.govern_changes (
  id         bigserial primary key,
  entity     text not null,
  entity_id  uuid not null,
  field      text not null,
  before     text,
  after      text,
  changed_by uuid references public.users(id) on delete set null,
  changed_at timestamptz not null default now()
);
create index if not exists idx_govern_changes_entity
  on public.govern_changes(entity, entity_id, changed_at desc);

alter table public.govern_changes enable row level security;
drop policy if exists "govern changes staff read" on public.govern_changes;
create policy "govern changes staff read" on public.govern_changes
  for select using (public.bos_is_staff());
-- Written by the trigger, which is security definer. Nobody writes it by hand,
-- and nobody edits or deletes it, which is what makes it worth reading.

create or replace function public.bos_track_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_before jsonb := to_jsonb(old);
  v_after  jsonb := to_jsonb(new);
  k text;
  a text;
  b text;
begin
  for k in select jsonb_object_keys(v_after) loop
    -- Bookkeeping columns are not news.
    if k in ('id', 'created_at', 'updated_at') then continue; end if;
    b := v_before ->> k;
    a := v_after  ->> k;
    if b is distinct from a then
      insert into public.govern_changes (entity, entity_id, field, before, after, changed_by)
      values (tg_table_name, new.id, k, b, a, auth.uid());
    end if;
  end loop;
  return new;
end;
$fn$;

-- ------------------------------------------------------------
-- Risks, and the issues they turn into
-- ------------------------------------------------------------
do $mig$ begin
  create type public.raid_kind as enum ('risk', 'issue');
exception when duplicate_object then null; end $mig$;

alter table public.risks
  add column if not exists kind              public.raid_kind not null default 'risk',
  add column if not exists inherent_impact   int,
  add column if not exists inherent_likelihood int,
  add column if not exists treatment         text,
  add column if not exists review_every_days int not null default 90,
  add column if not exists next_review       date,
  add column if not exists closed_at         timestamptz,
  add column if not exists occurred_on       date;

comment on column public.risks.kind is
  'A risk might happen; an issue already has. The same register holds both because one becomes the other.';
comment on column public.risks.impact is
  'Residual: what remains after the mitigation in place today.';
comment on column public.risks.inherent_impact is
  'Before any control. The gap between inherent and residual is what the control is worth.';

-- ------------------------------------------------------------
-- Complaints
-- ------------------------------------------------------------
do $mig$ begin
  create type public.complaint_state as enum
    ('new', 'acknowledged', 'investigating', 'awaiting', 'resolved', 'closed');
exception when duplicate_object then null; end $mig$;

create table if not exists public.complaints (
  id              uuid primary key default gen_random_uuid(),
  ref             text unique,
  channel         text,                     -- email, form, in person, social
  complainant     text,
  contact_email   text,
  subject         text not null,
  detail          text,
  severity        int not null default 3,   -- 1 worst
  state           public.complaint_state not null default 'new',
  owner_id        uuid references public.users(id) on delete set null,
  event_id        uuid references public.events(id) on delete set null,
  received_at     timestamptz not null default now(),
  acknowledge_by  timestamptz,
  acknowledged_at timestamptz,
  resolve_by      timestamptz,
  resolved_at     timestamptz,
  root_cause      text,
  resolution      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_complaints_state on public.complaints(state, resolve_by);

-- The clock starts when it arrives, not when somebody notices. Research is
-- consistent that acknowledgement speed is what complainants judge, so the two
-- deadlines are separate: one to reply at all, one to finish.
create or replace function public.bos_complaint_clock()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if tg_op = 'INSERT' then
    new.acknowledge_by := coalesce(new.acknowledge_by, new.received_at + interval '1 day');
    new.resolve_by := coalesce(
      new.resolve_by,
      new.received_at + case new.severity
        when 1 then interval '2 days'
        when 2 then interval '5 days'
        else interval '10 days'
      end);
    new.ref := coalesce(new.ref, 'C-' || to_char(now(), 'YYMM') || '-' ||
                 lpad((coalesce((select count(*) from public.complaints), 0) + 1)::text, 3, '0'));
  end if;

  if new.state <> 'new' and new.acknowledged_at is null then
    new.acknowledged_at := now();
  end if;
  if new.state in ('resolved', 'closed') and new.resolved_at is null then
    new.resolved_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists trg_bos_complaint_clock on public.complaints;
create trigger trg_bos_complaint_clock
  before insert or update on public.complaints
  for each row execute function public.bos_complaint_clock();

-- ------------------------------------------------------------
-- The data dictionary
-- ------------------------------------------------------------
do $mig$ begin
  create type public.data_class as enum ('public', 'internal', 'confidential', 'personal');
exception when duplicate_object then null; end $mig$;

create table if not exists public.data_fields (
  id             uuid primary key default gen_random_uuid(),
  table_name     text not null,
  column_name    text not null,
  description    text,
  classification public.data_class not null default 'internal',
  is_personal    boolean not null default false,
  lawful_basis   text,
  retention_days int,
  source_system  text,
  owner_id       uuid references public.users(id) on delete set null,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (table_name, column_name)
);
create index if not exists idx_data_fields_personal on public.data_fields(is_personal);

-- ------------------------------------------------------------
-- Documents: a version is a file, not a string
-- ------------------------------------------------------------
alter table public.assets
  add column if not exists review_every_days int not null default 365,
  add column if not exists category text;

create table if not exists public.asset_versions (
  id          uuid primary key default gen_random_uuid(),
  asset_id    uuid not null references public.assets(id) on delete cascade,
  version     text not null,
  link        text,
  note        text,
  uploaded_by uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_asset_versions on public.asset_versions(asset_id, created_at desc);

-- ------------------------------------------------------------
-- Equipment: who has it right now, and who had it before
-- ------------------------------------------------------------
alter table public.inventory
  add column if not exists serial_number text,
  add column if not exists custodian_id  uuid references public.users(id) on delete set null,
  add column if not exists issued_at     timestamptz;

create table if not exists public.inventory_custody (
  id           uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.inventory(id) on delete cascade,
  holder_id    uuid references public.users(id) on delete set null,
  issued_at    timestamptz not null default now(),
  returned_at  timestamptz,
  condition_out text,
  condition_in  text,
  note         text
);
create index if not exists idx_custody_item on public.inventory_custody(inventory_id, issued_at desc);

-- ------------------------------------------------------------
-- Access, and the tracking trigger, for everything governed
-- ------------------------------------------------------------
do $mig$
declare t text;
begin
  foreach t in array array['complaints','data_fields','asset_versions','inventory_custody'] loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists "govern staff read %1$s" on public.%1$I', t);
    execute format(
      'create policy "govern staff read %1$s" on public.%1$I for select using (public.bos_can_access(''govern''))', t);

    execute format('drop policy if exists "govern staff write %1$s" on public.%1$I', t);
    execute format(
      'create policy "govern staff write %1$s" on public.%1$I for all using (public.bos_can_access(''govern'')) with check (public.bos_can_access(''govern''))', t);
  end loop;

  -- One trigger, every governed table.
  foreach t in array array['risks','legal_items','assets','inventory','complaints','data_fields'] loop
    execute format('drop trigger if exists trg_bos_track_%1$s on public.%1$I', t);
    execute format(
      'create trigger trg_bos_track_%1$s after update on public.%1$I for each row execute function public.bos_track_changes()', t);
  end loop;
end $mig$;

-- ------------------------------------------------------------
-- What is overdue, across all of it
-- ------------------------------------------------------------
create or replace function public.bos_govern_attention()
returns table (area text, id uuid, label text, owner_id uuid, due date, days_late int)
language sql
stable
security definer
set search_path = public
as $fn$
  select 'Risk', r.id, coalesce(r.code || ' ', '') || r.risk, r.owner_id, r.next_review,
         (current_date - r.next_review)::int
    from public.risks r
   where r.next_review is not null and r.next_review < current_date and r.closed_at is null
  union all
  select 'Legal', l.id, l.requirement, l.owner_id, l.due_date, (current_date - l.due_date)::int
    from public.legal_items l
   where l.due_date is not null and l.due_date < current_date and l.status::text <> 'completed'
  union all
  select 'Complaint', c.id, coalesce(c.ref || ' ', '') || c.subject, c.owner_id, c.resolve_by::date,
         (current_date - c.resolve_by::date)::int
    from public.complaints c
   where c.resolve_by is not null and c.resolve_by < now() and c.state not in ('resolved', 'closed')
  union all
  select 'Document', a.id, a.name, a.owner_id, a.review_date, (current_date - a.review_date)::int
    from public.assets a
   where a.review_date is not null and a.review_date < current_date;
$fn$;

grant execute on function public.bos_govern_attention() to authenticated;
