-- ============================================================
-- Techxfluence — Admin Business Operating System (BOS)
-- Phase 1 foundation: strategy → goals → tasks → finance spine,
-- plus the tables the executive dashboard and later phases read.
--
-- Design principles (see AGENTS.md + existing schema.sql):
--   • Money is stored in PAISE (integer minor units), exactly like
--     public.payments.amount — so the dashboard can SUM across both.
--   • Access is gated by the existing public.is_admin() SECURITY DEFINER
--     helper. A new public.is_employee() mirrors it for staff.
--   • Everything foreign-keys into the EXISTING public.users / events /
--     partners tables. No user/member/event/host duplication.
--
-- Idempotent. Run in the Supabase SQL Editor.
-- ============================================================

-- ------------------------------------------------------------
-- New roles (extend the existing user_role enum; never replace it).
-- Compared by ::text elsewhere so these values are usable immediately.
-- ------------------------------------------------------------
alter type public.user_role add value if not exists 'employee';
alter type public.user_role add value if not exists 'college_ambassador';

-- ------------------------------------------------------------
-- BOS enums
-- ------------------------------------------------------------
do $$ begin
  create type public.bos_status as enum
    ('not_started','in_progress','blocked','completed','on_hold','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.bos_priority as enum ('critical','high','medium','low');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.bos_frequency as enum ('daily','weekly','monthly','one_time');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_stage as enum
    ('lead','contacted','qualified','proposal','negotiation','won','lost');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.approval_decision as enum ('pending','approved','rejected');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- Role helpers (SECURITY DEFINER, matching public.is_admin())
-- ------------------------------------------------------------
create or replace function public.is_employee()
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and primary_role::text = 'employee'
  ) or public.is_admin();
$$;

-- Staff = admin OR employee. Used for read access to operational tables.
create or replace function public.bos_is_staff()
returns boolean language sql security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.users
    where id = auth.uid() and primary_role::text in ('employee')
  );
$$;

-- ============================================================
-- Strategy spine — workstreams tie every module together.
-- ============================================================
create table if not exists public.workstreams (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique,          -- e.g. 'marketing', 'events'
  name       text not null,
  color      text,                          -- hex for dashboard chips
  sort_order int  not null default 0,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 90-day roadmap — strategic goals broken down by month/week.
-- ============================================================
create table if not exists public.goals (
  id            uuid primary key default gen_random_uuid(),
  code          text unique,                -- human ref e.g. G-001
  workstream_id uuid references public.workstreams(id) on delete set null,
  month         int,                        -- 1..3 (of the 90-day plan)
  week          int,                        -- 1..13
  objective     text not null,
  deliverable   text,
  owner_id      uuid references public.users(id) on delete set null,
  start_date    date,
  end_date      date,
  priority      bos_priority not null default 'medium',
  status        bos_status   not null default 'not_started',
  budget        int not null default 0,     -- paise
  target_kpi    text,
  actual_kpi    text,
  dependency_id uuid references public.goals(id) on delete set null,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_goals_workstream on public.goals(workstream_id);
create index if not exists idx_goals_status on public.goals(status);

-- ============================================================
-- Master task management — one centralized task system.
-- ============================================================
create table if not exists public.tasks (
  id            uuid primary key default gen_random_uuid(),
  code          text unique,
  workstream_id uuid references public.workstreams(id) on delete set null,
  goal_id       uuid references public.goals(id) on delete set null,
  title         text not null,
  description   text,
  owner_id      uuid references public.users(id) on delete set null,
  frequency     bos_frequency not null default 'one_time',
  start_date    date,
  due_date      date,
  status        bos_status   not null default 'not_started',
  priority      bos_priority not null default 'medium',
  dependency_id uuid references public.tasks(id) on delete set null,
  budget        int not null default 0,     -- paise
  actual_cost   int not null default 0,     -- paise
  target        numeric,
  actual        numeric,
  comments      text,
  attachment_url text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_tasks_owner on public.tasks(owner_id);
create index if not exists idx_tasks_due on public.tasks(due_date);
create index if not exists idx_tasks_status on public.tasks(status);
create index if not exists idx_tasks_workstream on public.tasks(workstream_id);

-- ============================================================
-- Data dictionary — every important KPI defined once.
-- ============================================================
create table if not exists public.kpis (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  definition text,
  formula    text,
  source     text,
  owner_id   uuid references public.users(id) on delete set null,
  frequency  bos_frequency not null default 'monthly',
  unit       text
);

create table if not exists public.kpi_values (
  id       uuid primary key default gen_random_uuid(),
  kpi_id   uuid not null references public.kpis(id) on delete cascade,
  period   date not null,
  target   numeric,
  actual   numeric,
  unique (kpi_id, period)
);

-- ============================================================
-- Finance — expenses, budgets, manual revenue, cash flow.
-- (Ticket/membership/sponsorship revenue already lives in payments.)
-- ============================================================
create table if not exists public.expenses (
  id             uuid primary key default gen_random_uuid(),
  category       text not null,             -- Marketing, Events, Salaries, ...
  subcategory    text,
  description    text,
  amount         int not null default 0,    -- paise
  spent_on       date not null default current_date,
  vendor         text,
  owner_id       uuid references public.users(id) on delete set null,
  workstream_id  uuid references public.workstreams(id) on delete set null,
  approval_status approval_decision not null default 'pending',
  payment_status text not null default 'unpaid', -- unpaid | paid
  recurring      boolean not null default false,
  receipt_url    text,
  created_at     timestamptz not null default now()
);
create index if not exists idx_expenses_spent_on on public.expenses(spent_on);
create index if not exists idx_expenses_category on public.expenses(category);

create table if not exists public.budgets (
  id            uuid primary key default gen_random_uuid(),
  workstream_id uuid references public.workstreams(id) on delete set null,
  category      text,
  period_month  date not null,             -- first of month
  amount        int not null default 0     -- paise
);

-- Manual / offline revenue that doesn't flow through the payments table.
create table if not exists public.revenue_entries (
  id               uuid primary key default gen_random_uuid(),
  source           text not null,          -- membership | ticket | sponsorship | service | other
  description      text,
  amount           int not null default 0, -- paise
  received_on      date not null default current_date,
  related_event_id uuid references public.events(id) on delete set null,
  workstream_id    uuid references public.workstreams(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists idx_revenue_received on public.revenue_entries(received_on);

-- Monthly cash-flow forecast, one row per (month, scenario).
create table if not exists public.cashflow_months (
  id               uuid primary key default gen_random_uuid(),
  month            date not null,          -- first of month
  scenario         text not null default 'base', -- base | conservative | growth
  opening_cash     int not null default 0, -- paise
  revenue_forecast int not null default 0,
  marketing_spend  int not null default 0,
  event_cost       int not null default 0,
  payroll          int not null default 0,
  hiring_cost      int not null default 0,
  technology_cost  int not null default 0,
  other_expenses   int not null default 0,
  unique (month, scenario)
);

-- ============================================================
-- Marketing — campaigns, content calendar, podcast.
-- ============================================================
create table if not exists public.campaigns (
  id                 uuid primary key default gen_random_uuid(),
  code               text unique,
  name               text not null,
  channel            text,                 -- Instagram, LinkedIn, YouTube, ...
  campaign_type      text,                 -- awareness | engagement | lead_gen | membership | event_reg | revenue | retention
  objective          text,
  audience           text,
  owner_id           uuid references public.users(id) on delete set null,
  workstream_id      uuid references public.workstreams(id) on delete set null,
  start_date         date,
  end_date           date,
  budget             int not null default 0, -- paise
  actual_spend       int not null default 0,
  target_reach       int not null default 0,
  actual_reach       int not null default 0,
  target_leads       int not null default 0,
  actual_leads       int not null default 0,
  target_conversions int not null default 0,
  actual_conversions int not null default 0,
  revenue_generated  int not null default 0, -- paise
  status             bos_status not null default 'not_started',
  created_at         timestamptz not null default now()
);

create table if not exists public.content_items (
  id           uuid primary key default gen_random_uuid(),
  content_date date not null default current_date,
  platform     text,
  content_type text,                       -- Post, Carousel, Reel, Short, ...
  topic        text,
  pillar       text,
  campaign_id  uuid references public.campaigns(id) on delete set null,
  audience     text,
  cta          text,
  owner_id     uuid references public.users(id) on delete set null,
  status       bos_status not null default 'not_started',
  asset_url    text,
  reach        int not null default 0,
  engagement   int not null default 0,
  leads        int not null default 0,
  conversions  int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists idx_content_date on public.content_items(content_date);

create table if not exists public.podcast_episodes (
  id               uuid primary key default gen_random_uuid(),
  number           int,
  title            text not null,
  guest            text,
  topic            text,
  recording_date   date,
  editing_status   text not null default 'not_started',
  publishing_status text not null default 'not_started',
  youtube_status   text not null default 'not_started',
  shorts_target    int not null default 0,
  shorts_published int not null default 0,
  views            int not null default 0,
  engagement       int not null default 0,
  leads            int not null default 0,
  conversions      int not null default 0,
  budget           int not null default 0, -- paise
  actual_cost      int not null default 0, -- paise
  created_at       timestamptz not null default now()
);

-- ============================================================
-- Sales / CRM — pipeline. weighted_revenue is computed.
-- ============================================================
create table if not exists public.leads (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  company          text,
  contact          text,
  source           text,
  requirement      text,
  expected_revenue int not null default 0,  -- paise
  probability      int not null default 0 check (probability between 0 and 100),
  weighted_revenue int generated always as (expected_revenue * probability / 100) stored,
  owner_id         uuid references public.users(id) on delete set null,
  campaign_id      uuid references public.campaigns(id) on delete set null,
  next_follow_up   date,
  stage            crm_stage not null default 'lead',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_leads_stage on public.leads(stage);

-- ============================================================
-- Community — partnerships, influencers, ambassadors.
-- (Hosts reuse users + host_submissions; members reuse memberships.)
-- ============================================================
create table if not exists public.partnerships (
  id             uuid primary key default gen_random_uuid(),
  partner_id     uuid references public.partners(id) on delete set null,
  name           text not null,
  partner_type   text,                     -- College, Corporate, Media, ...
  contact        text,
  owner_id       uuid references public.users(id) on delete set null,
  stage          text not null default 'prospect',
  start_date     date,
  end_date       date,
  expected_value int not null default 0,    -- paise
  actual_value   int not null default 0,    -- paise
  cost           int not null default 0,    -- paise
  status         bos_status not null default 'in_progress',
  next_action    text,
  created_at     timestamptz not null default now()
);

create table if not exists public.influencers (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  platform          text,
  category          text,
  followers         int not null default 0,
  engagement        numeric,                -- percent
  collaboration_type text,
  status            text not null default 'prospect',
  owner_id          uuid references public.users(id) on delete set null,
  budget            int not null default 0, -- paise
  actual_cost       int not null default 0, -- paise
  leads             int not null default 0,
  conversions       int not null default 0,
  members_generated int not null default 0,
  revenue_generated int not null default 0, -- paise
  created_at        timestamptz not null default now()
);

create table if not exists public.ambassadors (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references public.users(id) on delete set null,
  college          text not null,
  city             text,
  student_name     text not null,
  contact          text,
  status           text not null default 'active',
  start_date       date,
  owner_id         uuid references public.users(id) on delete set null,
  events_promoted  int not null default 0,
  leads            int not null default 0,
  registrations    int not null default 0,
  members_acquired int not null default 0,
  created_at       timestamptz not null default now()
);

-- ============================================================
-- People — employee extension of users (NOT a new user table).
-- ============================================================
create table if not exists public.employee_profiles (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null unique references public.users(id) on delete cascade,
  title        text,
  department   text,
  manager_id   uuid references public.users(id) on delete set null,
  start_date   date,
  monthly_cost int not null default 0,       -- paise
  status       text not null default 'active',
  created_at   timestamptz not null default now()
);

create table if not exists public.employee_kpis (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.users(id) on delete cascade,
  kpi_name    text not null,
  period      date not null default current_date,
  target      numeric,
  actual      numeric,
  created_at  timestamptz not null default now()
);

create table if not exists public.hiring_plan (
  id                uuid primary key default gen_random_uuid(),
  role              text not null,
  department        text,
  reason            text,
  target_month      date,
  monthly_cost      int not null default 0,  -- paise
  one_time_cost     int not null default 0,  -- paise
  recruitment_budget int not null default 0, -- paise
  start_date        date,
  status            bos_status not null default 'not_started',
  owner_id          uuid references public.users(id) on delete set null,
  expected_output   text,
  created_at        timestamptz not null default now()
);

-- ============================================================
-- Governance — app-dev tracker, risks, approvals, legal, SOPs.
-- ============================================================
create table if not exists public.app_modules (
  id            uuid primary key default gen_random_uuid(),
  module        text not null,
  feature       text,
  user_story    text,
  owner_id      uuid references public.users(id) on delete set null,
  developer     text,
  qa            text,
  environment   text not null default 'development', -- development | qa | staging | production
  status        bos_status not null default 'not_started',
  priority      bos_priority not null default 'medium',
  dependency_id uuid references public.app_modules(id) on delete set null,
  bug_count     int not null default 0,
  release       text,
  target_date   date,
  created_at    timestamptz not null default now()
);

create table if not exists public.risks (
  id            uuid primary key default gen_random_uuid(),
  code          text unique,
  area          text,
  risk          text not null,
  impact        int not null default 1 check (impact between 1 and 5),
  likelihood    int not null default 1 check (likelihood between 1 and 5),
  risk_score    int generated always as (impact * likelihood) stored,
  owner_id      uuid references public.users(id) on delete set null,
  status        bos_status not null default 'not_started',
  mitigation    text,
  due_date      date,
  created_at    timestamptz not null default now()
);

create table if not exists public.approvals (
  id            uuid primary key default gen_random_uuid(),
  request_type  text not null,             -- Event, Host, Expense, Campaign, ...
  request_title text not null,
  requester_id  uuid references public.users(id) on delete set null,
  approver_id   uuid references public.users(id) on delete set null,
  amount        int not null default 0,    -- paise
  decision      approval_decision not null default 'pending',
  decided_at    timestamptz,
  comments      text,
  related_type  text,
  related_id    uuid,
  created_at    timestamptz not null default now()
);
create index if not exists idx_approvals_decision on public.approvals(decision);

create table if not exists public.legal_items (
  id           uuid primary key default gen_random_uuid(),
  requirement  text not null,
  owner_id     uuid references public.users(id) on delete set null,
  due_date     date,
  status       bos_status not null default 'not_started',
  risk         text,
  document_url text,
  expiry_date  date,
  renewal_date date,
  created_at   timestamptz not null default now()
);

create table if not exists public.sops (
  id            uuid primary key default gen_random_uuid(),
  process       text not null,
  step          text,
  owner_id      uuid references public.users(id) on delete set null,
  frequency     bos_frequency not null default 'monthly',
  quality_check text,
  pass_criteria text,
  evidence_url  text,
  last_reviewed date,
  next_review   date,
  status        bos_status not null default 'not_started',
  created_at    timestamptz not null default now()
);

-- ============================================================
-- Audit log — every important BOS mutation.
-- ============================================================
create table if not exists public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.users(id) on delete set null,
  action     text not null,               -- insert | update | delete
  entity     text not null,               -- table name
  entity_id  uuid,
  before     jsonb,
  after      jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_created on public.audit_log(created_at desc);

-- ============================================================
-- updated_at triggers (reuse the existing set_updated_at()).
-- ============================================================
drop trigger if exists trg_goals_updated on public.goals;
create trigger trg_goals_updated before update on public.goals
  for each row execute function public.set_updated_at();

drop trigger if exists trg_tasks_updated on public.tasks;
create trigger trg_tasks_updated before update on public.tasks
  for each row execute function public.set_updated_at();

drop trigger if exists trg_leads_updated on public.leads;
create trigger trg_leads_updated before update on public.leads
  for each row execute function public.set_updated_at();

-- ============================================================
-- Row-Level Security
--   • Admins fully manage every BOS table.
--   • Staff (employees) can READ operational tables and UPDATE the
--     tasks they own. Finance-sensitive tables stay admin-only for now;
--     the Employee Workspace (Phase 3) widens this deliberately.
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array[
    'workstreams','goals','tasks','kpis','kpi_values','expenses','budgets',
    'revenue_entries','cashflow_months','campaigns','content_items',
    'podcast_episodes','leads','partnerships','influencers','ambassadors',
    'employee_profiles','employee_kpis','hiring_plan','app_modules','risks',
    'approvals','legal_items','sops','audit_log'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "admin manage %1$s" on public.%1$I', t);
    execute format(
      'create policy "admin manage %1$s" on public.%1$I for all using (public.is_admin()) with check (public.is_admin())', t);
  end loop;

  -- Staff read access on operational (non-finance) tables.
  foreach t in array array[
    'workstreams','goals','tasks','kpis','kpi_values','campaigns',
    'content_items','podcast_episodes','leads','app_modules','sops','risks'
  ]
  loop
    execute format('drop policy if exists "staff read %1$s" on public.%1$I', t);
    execute format(
      'create policy "staff read %1$s" on public.%1$I for select using (public.bos_is_staff())', t);
  end loop;
end $$;

-- An employee may update the tasks assigned to them.
drop policy if exists "owner update own task" on public.tasks;
create policy "owner update own task" on public.tasks
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ============================================================
-- Seed the strategy spine so every module has a workstream to hang off.
-- ============================================================
insert into public.workstreams (key, name, color, sort_order) values
  ('strategy',    'Strategy',              '#2563eb', 1),
  ('marketing',   'Marketing',             '#ec4899', 2),
  ('content',     'Content',               '#8b5cf6', 3),
  ('events',      'Events',                '#f59e0b', 4),
  ('membership',  'Membership',            '#10b981', 5),
  ('community',   'Community',             '#06b6d4', 6),
  ('sales',       'Sales',                 '#ef4444', 7),
  ('partnerships','Partnerships',          '#14b8a6', 8),
  ('finance',     'Finance',               '#22c55e', 9),
  ('people',      'People & Hiring',       '#a855f7', 10),
  ('product',     'Application Development','#3b82f6', 11),
  ('legal',       'Legal & Compliance',    '#64748b', 12)
on conflict (key) do nothing;

-- ============================================================
-- Executive dashboard summary — ONE admin-gated call that stitches
-- existing tables (payments, events, registrations, memberships) together
-- with the new BOS tables. All money is paise. Time-bounded metrics honour
-- [p_from, p_to]; stock metrics (totals, pipeline, open items) are current.
-- ============================================================
create or replace function public.bos_dashboard_summary(
  p_from date default null,
  p_to   date default null
)
returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare
  v_from date := coalesce(p_from, date_trunc('year', current_date)::date);
  v_to   date := coalesce(p_to, current_date);
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;

  return jsonb_build_object(
    -- ---- Finance ----
    'revenue_actual', (
      coalesce((select sum(amount) from public.payments
        where status = 'paid' and created_at::date between v_from and v_to), 0)
      + coalesce((select sum(amount) from public.revenue_entries
        where received_on between v_from and v_to), 0)
    ),
    'revenue_target', coalesce((select sum(target_kpi::numeric)
        from public.goals g join public.workstreams w on w.id = g.workstream_id
        where w.key in ('finance','sales','membership','events')
          and g.target_kpi ~ '^[0-9]+$'), 0),
    'expenses_total', coalesce((select sum(amount) from public.expenses
        where spent_on between v_from and v_to), 0),
    'expenses_forecast', coalesce((select sum(marketing_spend + event_cost + payroll
        + hiring_cost + technology_cost + other_expenses)
        from public.cashflow_months where scenario = 'base'), 0),
    'cash_position', coalesce((select closing.opening_cash from (
        select opening_cash from public.cashflow_months
        where scenario = 'base' order by month desc limit 1) closing), 0),

    -- ---- Membership (stock) ----
    'members_total', (select count(*) from public.memberships where status = 'active'),
    'members_free',  (select count(*) from public.memberships where status = 'active' and tier = 'Free'),
    'members_paid',  (select count(*) from public.memberships where status = 'active' and tier = 'Pro'),
    'members_elite', (select count(*) from public.memberships where status = 'active' and tier = 'Elite'),
    'members_new',   (select count(*) from public.memberships
        where started_at::date between v_from and v_to),

    -- ---- Community (stock) ----
    'influencers', (select count(*) from public.influencers),
    'ambassadors', (select count(*) from public.ambassadors where status = 'active'),
    'hosts',       (select count(*) from public.users where primary_role = 'event_host'),
    'partners',    (select count(*) from public.partnerships),

    -- ---- Events ----
    'events_upcoming', (select count(*) from public.events
        where status = 'published' and date >= current_date),
    'events_completed', (select count(*) from public.events where status = 'completed'),
    'events_registrations', (select count(*) from public.registrations r
        join public.events e on e.id = r.event_id
        where r.registered_at::date between v_from and v_to
          and r.status in ('registered','attended')),
    'events_attendance', (select count(*) from public.registrations
        where status = 'attended' and checked_in_at::date between v_from and v_to),

    -- ---- Marketing ----
    'mkt_spend', coalesce((select sum(actual_spend) from public.campaigns), 0),
    'mkt_leads', coalesce((select sum(actual_leads) from public.campaigns), 0),
    'mkt_conversions', coalesce((select sum(actual_conversions) from public.campaigns), 0),
    'mkt_reach', coalesce((select sum(actual_reach) from public.campaigns), 0),
    'mkt_revenue', coalesce((select sum(revenue_generated) from public.campaigns), 0),
    'content_published', (select count(*) from public.content_items where status = 'completed'),

    -- ---- Sales ----
    'leads_total', (select count(*) from public.leads),
    'pipeline_value', coalesce((select sum(expected_revenue) from public.leads
        where stage not in ('won','lost')), 0),
    'weighted_pipeline', coalesce((select sum(weighted_revenue) from public.leads
        where stage not in ('won','lost')), 0),
    'deals_won', (select count(*) from public.leads where stage = 'won'),
    'deals_lost', (select count(*) from public.leads where stage = 'lost'),

    -- ---- Control center ----
    'tasks_open', (select count(*) from public.tasks
        where status not in ('completed','cancelled')),
    'tasks_overdue', (select count(*) from public.tasks
        where due_date < current_date and status not in ('completed','cancelled')),
    'tasks_due_today', (select count(*) from public.tasks
        where due_date = current_date and status not in ('completed','cancelled')),
    'tasks_blocked', (select count(*) from public.tasks where status = 'blocked'),
    'approvals_pending', (select count(*) from public.approvals where decision = 'pending'),
    'risks_open', (select count(*) from public.risks
        where status not in ('completed','cancelled')),
    'risks_critical', (select count(*) from public.risks
        where risk_score >= 15 and status not in ('completed','cancelled')),

    -- ---- Goals (roadmap) by status ----
    'goals', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (
        select status::text, count(*) n from public.goals group by status) s),

    'range', jsonb_build_object('from', v_from, 'to', v_to)
  );
end $$;

grant execute on function public.bos_dashboard_summary(date, date) to authenticated;
grant execute on function public.is_employee() to authenticated;
grant execute on function public.bos_is_staff() to authenticated;
