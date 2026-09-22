-- ============================================================
-- Techxfluence Business OS — coverage pass.
--   • event_ops: BOS financial/ops extension of the existing events
--     table (type, client, owner, budget, cost, revenue target, campaign,
--     partners, feedback) — NOT a duplicate events table.
--   • memberships.source: acquisition-source attribution.
--   • ambassadors self-read for the College Ambassador portal.
--   • Expanded bos_dashboard_summary: Application + People sections,
--     forecast revenue / burn / runway, event financials, richer sales &
--     membership, and owner/workstream filters.
-- Idempotent. Run AFTER 0007-0009.
-- ============================================================

-- ---------- Events BOS extension (1:1 with public.events) ----------
create table if not exists public.event_ops (
  id                    uuid primary key default gen_random_uuid(),
  event_id              uuid not null unique references public.events(id) on delete cascade,
  event_type            text,
  is_client_event       boolean not null default false,
  client_name           text,
  owner_id              uuid references public.users(id) on delete set null,
  budget                int not null default 0,   -- paise
  actual_cost           int not null default 0,   -- paise
  revenue_target        int not null default 0,   -- paise
  marketing_campaign_id uuid references public.campaigns(id) on delete set null,
  partners              text,
  feedback              text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

drop trigger if exists trg_event_ops_updated on public.event_ops;
create trigger trg_event_ops_updated before update on public.event_ops
  for each row execute function public.set_updated_at();

alter table public.event_ops enable row level security;
drop policy if exists "admin manage event_ops" on public.event_ops;
create policy "admin manage event_ops" on public.event_ops
  for all using (public.is_admin()) with check (public.is_admin());
-- Hosts may read the ops row for events they own (no finance leakage beyond their own).
drop policy if exists "host read own event_ops" on public.event_ops;
create policy "host read own event_ops" on public.event_ops
  for select using (exists (
    select 1 from public.events e where e.id = event_ops.event_id and e.host_id = auth.uid()
  ));

-- ---------- Membership acquisition source ----------
alter table public.memberships add column if not exists source text;

-- ---------- College Ambassador self-read (portal) ----------
drop policy if exists "ambassador reads own" on public.ambassadors;
create policy "ambassador reads own" on public.ambassadors
  for select using (user_id = auth.uid() or public.is_admin());

-- ---------- Employee Workspace: read own approvals & event ops, update own KPI actuals ----------
drop policy if exists "staff read own approvals" on public.approvals;
create policy "staff read own approvals" on public.approvals
  for select using (requester_id = auth.uid() or approver_id = auth.uid());

drop policy if exists "staff read owned event_ops" on public.event_ops;
create policy "staff read owned event_ops" on public.event_ops
  for select using (owner_id = auth.uid());

drop policy if exists "staff update own kpi" on public.employee_kpis;
create policy "staff update own kpi" on public.employee_kpis
  for update using (employee_id = auth.uid()) with check (employee_id = auth.uid());

-- ============================================================
-- Expanded executive dashboard summary.
--   p_owner / p_workstream scope the operational sections
--   (tasks, goals, campaigns, expenses, leads).
-- ============================================================
create or replace function public.bos_dashboard_summary(
  p_from       date default null,
  p_to         date default null,
  p_owner      uuid default null,
  p_workstream uuid default null
)
returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare
  v_from date := coalesce(p_from, date_trunc('year', current_date)::date);
  v_to   date := coalesce(p_to, current_date);
  v_burn numeric; v_cash numeric; v_open_cash numeric;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;

  -- Latest base cash-flow row -> closing cash + a simple 1-month burn proxy.
  select opening_cash
       + revenue_forecast
       - (marketing_spend + event_cost + payroll + hiring_cost + technology_cost + other_expenses),
         (marketing_spend + event_cost + payroll + hiring_cost + technology_cost + other_expenses) - revenue_forecast
    into v_cash, v_burn
    from public.cashflow_months
   where scenario = 'base'
   order by month desc limit 1;
  v_cash := coalesce(v_cash, 0);
  v_burn := greatest(coalesce(v_burn, 0), 0);

  return jsonb_build_object(
    -- ---- Finance ----
    'revenue_actual', (
      coalesce((select sum(amount) from public.payments where status='paid' and created_at::date between v_from and v_to), 0)
      + coalesce((select sum(amount) from public.revenue_entries where received_on between v_from and v_to
                  and (p_workstream is null or workstream_id = p_workstream)), 0)),
    'revenue_target', coalesce((select sum(target_kpi::numeric) from public.goals g
        join public.workstreams w on w.id = g.workstream_id
        where w.key in ('finance','sales','membership','events') and g.target_kpi ~ '^[0-9]+$'
          and (p_owner is null or g.owner_id = p_owner)
          and (p_workstream is null or g.workstream_id = p_workstream)), 0),
    'revenue_forecast', coalesce((select sum(revenue_forecast) from public.cashflow_months where scenario='base'), 0),
    'expenses_total', coalesce((select sum(amount) from public.expenses where spent_on between v_from and v_to
        and (p_owner is null or owner_id = p_owner)
        and (p_workstream is null or workstream_id = p_workstream)), 0),
    'expenses_forecast', coalesce((select sum(marketing_spend+event_cost+payroll+hiring_cost+technology_cost+other_expenses)
        from public.cashflow_months where scenario='base'), 0),
    'cash_position', v_cash,
    'monthly_burn', v_burn,
    'runway_months', case when v_burn > 0 then round((v_cash / v_burn)::numeric, 1) else null end,

    -- ---- Membership ----
    'members_total', (select count(*) from public.memberships where status='active'),
    'members_free',  (select count(*) from public.memberships where status='active' and tier='Free'),
    'members_paid',  (select count(*) from public.memberships where status='active' and tier='Pro'),
    'members_elite', (select count(*) from public.memberships where status='active' and tier='Elite'),
    'members_new',   (select count(*) from public.memberships where started_at::date between v_from and v_to),
    'member_conversion', (select case when count(*)=0 then 0 else
        round(100.0 * count(*) filter (where tier in ('Pro','Elite')) / count(*), 1) end
        from public.memberships where status='active'),
    'member_retention', (select case when count(*)=0 then 0 else
        round(100.0 * count(*) filter (where status='active') / count(*), 1) end from public.memberships),

    -- ---- Community ----
    'influencers', (select count(*) from public.influencers),
    'ambassadors', (select count(*) from public.ambassadors where status='active'),
    'hosts',       (select count(*) from public.users where primary_role='event_host'),
    'partners',    (select count(*) from public.partnerships),

    -- ---- Events ----
    'events_upcoming', (select count(*) from public.events where status='published' and date >= current_date),
    'events_completed', (select count(*) from public.events where status='completed'),
    'events_registrations', (select count(*) from public.registrations r
        where r.registered_at::date between v_from and v_to and r.status in ('registered','attended')),
    'events_attendance', (select count(*) from public.registrations
        where status='attended' and checked_in_at::date between v_from and v_to),
    'event_revenue', coalesce((select sum(amount) from public.payments
        where related_type='events' and status='paid' and created_at::date between v_from and v_to), 0),
    'event_cost', coalesce((select sum(actual_cost) from public.event_ops), 0),
    'client_events', (select count(*) from public.event_ops where is_client_event),
    'owned_events', (select count(*) from public.event_ops where not is_client_event),

    -- ---- Marketing ----
    'mkt_spend', coalesce((select sum(actual_spend) from public.campaigns
        where (p_owner is null or owner_id=p_owner) and (p_workstream is null or workstream_id=p_workstream)), 0),
    'mkt_leads', coalesce((select sum(actual_leads) from public.campaigns
        where (p_owner is null or owner_id=p_owner) and (p_workstream is null or workstream_id=p_workstream)), 0),
    'mkt_conversions', coalesce((select sum(actual_conversions) from public.campaigns
        where (p_owner is null or owner_id=p_owner) and (p_workstream is null or workstream_id=p_workstream)), 0),
    'mkt_reach', coalesce((select sum(actual_reach) from public.campaigns
        where (p_owner is null or owner_id=p_owner) and (p_workstream is null or workstream_id=p_workstream)), 0),
    'mkt_revenue', coalesce((select sum(revenue_generated) from public.campaigns), 0),
    'content_published', (select count(*) from public.content_items where status='completed'),

    -- ---- Sales ----
    'leads_total', (select count(*) from public.leads where (p_owner is null or owner_id=p_owner)),
    'leads_qualified', (select count(*) from public.leads where stage='qualified' and (p_owner is null or owner_id=p_owner)),
    'leads_proposal', (select count(*) from public.leads where stage='proposal' and (p_owner is null or owner_id=p_owner)),
    'leads_negotiation', (select count(*) from public.leads where stage='negotiation' and (p_owner is null or owner_id=p_owner)),
    'pipeline_value', coalesce((select sum(expected_revenue) from public.leads
        where stage not in ('won','lost') and (p_owner is null or owner_id=p_owner)), 0),
    'weighted_pipeline', coalesce((select sum(weighted_revenue) from public.leads
        where stage not in ('won','lost') and (p_owner is null or owner_id=p_owner)), 0),
    'revenue_closed', coalesce((select sum(expected_revenue) from public.leads where stage='won'), 0),
    'deals_won', (select count(*) from public.leads where stage='won'),
    'deals_lost', (select count(*) from public.leads where stage='lost'),

    -- ---- Application development ----
    'app_total', (select count(*) from public.app_modules),
    'app_completed', (select count(*) from public.app_modules where status='completed'),
    'app_pending', (select count(*) from public.app_modules where status in ('not_started','in_progress','on_hold')),
    'app_blocked', (select count(*) from public.app_modules where status='blocked'),
    'app_bugs', coalesce((select sum(bug_count) from public.app_modules), 0),
    'app_progress', (select case when count(*)=0 then 0 else
        round(100.0 * count(*) filter (where status='completed') / count(*)) end from public.app_modules),

    -- ---- People ----
    'employees', (select count(*) from public.employee_profiles where status='active'),
    'open_positions', (select count(*) from public.hiring_plan where status not in ('completed','cancelled')),
    'planned_hires', (select count(*) from public.hiring_plan where status not in ('completed','cancelled')),
    'monthly_payroll', coalesce((select sum(monthly_cost) from public.employee_profiles where status='active'), 0),
    'hiring_cost', coalesce((select sum(one_time_cost + recruitment_budget) from public.hiring_plan
        where status not in ('completed','cancelled')), 0),
    'emp_kpi_achievement', (select case when coalesce(sum(target),0)=0 then 0 else
        round(100.0 * sum(actual) / sum(target)) end from public.employee_kpis
        where period between v_from and v_to),

    -- ---- Control center ----
    'tasks_open', (select count(*) from public.tasks where status not in ('completed','cancelled')
        and (p_owner is null or owner_id=p_owner) and (p_workstream is null or workstream_id=p_workstream)),
    'tasks_overdue', (select count(*) from public.tasks where due_date < current_date and status not in ('completed','cancelled')
        and (p_owner is null or owner_id=p_owner) and (p_workstream is null or workstream_id=p_workstream)),
    'tasks_due_today', (select count(*) from public.tasks where due_date = current_date and status not in ('completed','cancelled')
        and (p_owner is null or owner_id=p_owner) and (p_workstream is null or workstream_id=p_workstream)),
    'tasks_critical', (select count(*) from public.tasks where priority='critical' and status not in ('completed','cancelled')
        and (p_owner is null or owner_id=p_owner) and (p_workstream is null or workstream_id=p_workstream)),
    'tasks_blocked', (select count(*) from public.tasks where status='blocked'
        and (p_owner is null or owner_id=p_owner) and (p_workstream is null or workstream_id=p_workstream)),
    'approvals_pending', (select count(*) from public.approvals where decision='pending'),
    'risks_open', (select count(*) from public.risks where status not in ('completed','cancelled')),
    'risks_critical', (select count(*) from public.risks where risk_score >= 15 and status not in ('completed','cancelled')),
    'deps_open', (select count(*) from public.dependencies where status='open'),
    'contracts_expiring', (
      (select count(*) from public.legal_items where expiry_date between current_date and current_date + 30)
      + (select count(*) from public.vendors where end_date between current_date and current_date + 30)),

    -- ---- Goals (roadmap) by status ----
    'goals', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (
        select status::text, count(*) n from public.goals
        where (p_owner is null or owner_id=p_owner) and (p_workstream is null or workstream_id=p_workstream)
        group by status) s),

    'range', jsonb_build_object('from', v_from, 'to', v_to)
  );
end $$;

grant execute on function public.bos_dashboard_summary(date, date, uuid, uuid) to authenticated;
