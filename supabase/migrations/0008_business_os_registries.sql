-- ============================================================
-- Techxfluence Business OS — Phase 2-4 additions.
--   • Registry tables: vendors, assets, inventory, competitors,
--     feedback, dependencies.
--   • Widened staff RLS so the Employee Workspace can submit
--     expenses and leads and read its own KPIs.
-- Idempotent. Run in the Supabase SQL Editor AFTER 0007.
-- ============================================================

create table if not exists public.vendors (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  category     text,
  contact      text,
  service      text,
  contract     text,
  start_date   date,
  end_date     date,
  monthly_cost int not null default 0,     -- paise
  status       text not null default 'active',
  owner_id     uuid references public.users(id) on delete set null,
  performance  text,
  created_at   timestamptz not null default now()
);

create table if not exists public.assets (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  type          text,                       -- Brand, Social, Event, Legal, ...
  workstream_id uuid references public.workstreams(id) on delete set null,
  owner_id      uuid references public.users(id) on delete set null,
  version       text,
  status        text not null default 'draft',
  link          text,
  created_date  date default current_date,
  review_date   date,
  created_at    timestamptz not null default now()
);

create table if not exists public.inventory (
  id            uuid primary key default gen_random_uuid(),
  item          text not null,
  category      text,
  quantity      int not null default 1,
  unit_cost     int not null default 0,     -- paise
  total_value   int generated always as (quantity * unit_cost) stored,
  location      text,
  assigned_to   uuid references public.users(id) on delete set null,
  condition     text,
  purchase_date date,
  status        text not null default 'in_use',
  created_at    timestamptz not null default now()
);

create table if not exists public.competitors (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  category        text,
  offer           text,
  business_model  text,
  pricing         text,
  target_audience text,
  strengths       text,
  gaps            text,
  our_response    text,
  review_date     date,
  created_at      timestamptz not null default now()
);

create table if not exists public.feedback (
  id             uuid primary key default gen_random_uuid(),
  source_type    text not null default 'member', -- member | attendee | host | client | partner | ambassador
  rating         int check (rating between 1 and 5),
  feedback       text,
  issue          text,
  owner_id       uuid references public.users(id) on delete set null,
  action         text,
  resolution     text,
  retention_risk text not null default 'low',    -- low | medium | high
  created_at     timestamptz not null default now()
);

-- Generic dependency edges between any two BOS records.
create table if not exists public.dependencies (
  id         uuid primary key default gen_random_uuid(),
  from_type  text not null,
  from_id    uuid,
  to_type    text not null,
  to_id      uuid,
  note       text,
  status     text not null default 'open',
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- RLS: admins fully manage the new tables.
-- ------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'vendors','assets','inventory','competitors','feedback','dependencies'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "admin manage %1$s" on public.%1$I', t);
    execute format(
      'create policy "admin manage %1$s" on public.%1$I for all using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- ------------------------------------------------------------
-- Employee Workspace access (deliberately widened from 0007):
--   • submit + read their own expenses
--   • create leads and update the ones they own
--   • read their own KPI rows
-- ------------------------------------------------------------
drop policy if exists "staff read own expense" on public.expenses;
create policy "staff read own expense" on public.expenses
  for select using (owner_id = auth.uid());

drop policy if exists "staff insert own expense" on public.expenses;
create policy "staff insert own expense" on public.expenses
  for insert with check (public.bos_is_staff() and owner_id = auth.uid());

drop policy if exists "staff read leads" on public.leads;
create policy "staff read leads" on public.leads
  for select using (public.bos_is_staff());

drop policy if exists "staff insert lead" on public.leads;
create policy "staff insert lead" on public.leads
  for insert with check (public.bos_is_staff());

drop policy if exists "staff update own lead" on public.leads;
create policy "staff update own lead" on public.leads
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "staff read own kpis" on public.employee_kpis;
create policy "staff read own kpis" on public.employee_kpis
  for select using (employee_id = auth.uid() or public.is_admin());

-- Employees may create tasks assigned to themselves (0007 already lets task
-- owners update their own rows).
drop policy if exists "staff insert own task" on public.tasks;
create policy "staff insert own task" on public.tasks
  for insert with check (public.bos_is_staff() and owner_id = auth.uid());
