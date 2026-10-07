import { createClient } from "@/lib/supabase/server";
import { BarList, type BarDatum } from "@/components/os/BarList";
import { SectionHeading, Panel, PanelStat, Meter } from "@/components/os/ui";
import { inrCompact, num, pct, type DashboardSummary } from "@/lib/bos";
import { requireSection } from "@/lib/os-access";

export const metadata = { title: "Analytics · Shreex" };

const top = (arr: BarDatum[], n = 8) =>
  arr.filter((d) => d.value > 0).sort((a, b) => b.value - a.value).slice(0, n);

export default async function AnalyticsPage() {
  await requireSection("insights");
  const supabase = await createClient();

  const [
    { data: campaigns },
    { data: leads },
    { data: influencers },
    { data: ambassadors },
    { data: payments },
    { data: events },
    { data: empKpis },
    { data: content },
    { data: users },
  ] = await Promise.all([
    supabase.from("campaigns").select("name,channel,actual_leads,actual_spend,revenue_generated,actual_conversions"),
    supabase.from("leads").select("stage,source,expected_revenue,weighted_revenue"),
    supabase.from("influencers").select("name,conversions,members_generated"),
    supabase.from("ambassadors").select("student_name,college,members_acquired"),
    supabase.from("payments").select("amount,related_id,related_type,status").eq("status", "paid"),
    supabase.from("events").select("id,title"),
    supabase.from("employee_kpis").select("employee_id,kpi_name,target,actual"),
    supabase.from("content_items").select("platform,leads,reach"),
    supabase.from("users").select("id,full_name"),
  ]);

  // The full statistical breakdown used to sit on the dashboard. It moved here
  // when the dashboard was cut back to one card per section: this is the
  // drill-down, so nothing was lost, it just stopped competing for attention.
  const { data: summary } = await supabase.rpc("bos_dashboard_summary", {
    p_from: `${new Date().getFullYear()}-01-01`,
    p_to: new Date().toISOString().slice(0, 10),
    p_owner: null,
    p_workstream: null,
  });
  const d = (summary ?? {}) as DashboardSummary;
  const netCash = (d.revenue_actual ?? 0) - (d.expenses_total ?? 0);
  const hasTarget = (d.revenue_target ?? 0) > 0;
  const eventProfit = (d.event_revenue ?? 0) - (d.event_cost ?? 0);
  const FIN = "/shreex/finance";
  const T = "/shreex/tasks";

  const C = campaigns ?? [];
  const L = leads ?? [];

  // Leads by channel
  const byChannel = new Map<string, number>();
  for (const c of C) if (c.channel) byChannel.set(c.channel, (byChannel.get(c.channel) ?? 0) + (c.actual_leads ?? 0));
  const leadsByChannel = top([...byChannel].map(([label, value]) => ({ label, value })));

  // Campaign ROI
  const roi: BarDatum[] = top(
    C.filter((c) => (c.actual_spend ?? 0) > 0).map((c) => {
      const r = (((c.revenue_generated ?? 0) - (c.actual_spend ?? 0)) / (c.actual_spend as number)) * 100;
      return { label: c.name, value: Math.round(r), display: `${Math.round(r)}%` };
    }),
  );

  // Event revenue (from payments joined to events)
  const evTitle = new Map((events ?? []).map((e) => [e.id, e.title]));
  const evRev = new Map<string, number>();
  for (const p of payments ?? []) {
    if (p.related_type === "events" && p.related_id) evRev.set(p.related_id, (evRev.get(p.related_id) ?? 0) + (p.amount ?? 0));
  }
  const eventRevenue = top(
    [...evRev].map(([id, value]) => ({ label: evTitle.get(id) ?? "Event", value, display: inrCompact(value) })),
  );

  // Pipeline by stage
  const byStage = new Map<string, number>();
  for (const l of L) byStage.set(l.stage, (byStage.get(l.stage) ?? 0) + (l.expected_revenue ?? 0));
  const pipelineByStage = [...byStage].map(([label, value]) => ({ label, value, display: inrCompact(value) }));

  // Leads by source
  const bySource = new Map<string, number>();
  for (const l of L) if (l.source) bySource.set(l.source, (bySource.get(l.source) ?? 0) + 1);
  const leadsBySource = top([...bySource].map(([label, value]) => ({ label, value })));

  // Influencer conversions
  const inflConv = top((influencers ?? []).map((i) => ({ label: i.name, value: i.conversions ?? 0 })));

  // Ambassador members acquired
  const ambMembers = top(
    (ambassadors ?? []).map((a) => ({ label: `${a.student_name} · ${a.college ?? ""}`.trim(), value: a.members_acquired ?? 0 })),
  );

  // Content leads by platform
  const cByPlat = new Map<string, number>();
  for (const c of content ?? []) if (c.platform) cByPlat.set(c.platform, (cByPlat.get(c.platform) ?? 0) + (c.leads ?? 0));
  const contentLeads = top([...cByPlat].map(([label, value]) => ({ label, value })));

  // Employee KPI achievement %
  const uName = new Map((users ?? []).map((u) => [u.id, u.full_name]));
  const empByUser = new Map<string, { t: number; a: number }>();
  for (const k of empKpis ?? []) {
    const cur = empByUser.get(k.employee_id) ?? { t: 0, a: 0 };
    cur.t += Number(k.target ?? 0);
    cur.a += Number(k.actual ?? 0);
    empByUser.set(k.employee_id, cur);
  }
  const empAchievement = top(
    [...empByUser].map(([id, { t, a }]) => ({
      label: uName.get(id) ?? "Employee",
      value: t > 0 ? Math.round((a / t) * 100) : 0,
      display: t > 0 ? `${Math.round((a / t) * 100)}%` : "—",
    })),
  );

  return (
    <>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-fg">Business Intelligence</h1>
        <p className="text-sm text-muted">
          Which channels, campaigns, events and people are driving results — from live data only.
        </p>
      </div>

      <SectionHeading title="Full breakdown" desc="Every figure behind the dashboard cards" />
      <div className="mb-8">
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel icon="trophy" title="Business health" desc="Money in, money out, forecast and runway">
          <div className="grid grid-cols-3 gap-1">
            <PanelStat label="Revenue" value={inrCompact(d.revenue_actual)} tone="good" href={FIN} />
            <PanelStat label="Expenses" value={inrCompact(d.expenses_total)} tone="warn" href={FIN} />
            <PanelStat label="Profit / loss" value={inrCompact(netCash)} tone={netCash >= 0 ? "good" : "bad"} href={FIN} />
            <PanelStat label="Forecast" value={inrCompact(d.revenue_forecast)} href={FIN} />
            <PanelStat label="Monthly burn" value={inrCompact(d.monthly_burn)} tone="warn" href={FIN} />
            <PanelStat
              label="Runway"
              value={d.runway_months != null ? `${d.runway_months} mo` : "No burn"}
              tone={d.runway_months != null && d.runway_months < 3 ? "bad" : "default"}
              href={FIN}
            />
          </div>
          {hasTarget && (
            <div className="mt-4">
              <div className="mb-1 flex justify-between text-[11px] text-muted">
                <span>Revenue vs target</span>
                <span className="tabular-nums">{inrCompact(d.revenue_actual)} / {inrCompact(d.revenue_target)}</span>
              </div>
              <Meter actual={d.revenue_actual} target={d.revenue_target} />
            </div>
          )}
        </Panel>

        <Panel icon="code" title="Application" desc="Product development progress" tone="brand">
          <div className="mb-4">
            <div className="mb-1 flex justify-between text-[11px] text-muted">
              <span>Dev progress</span>
              <span className="tabular-nums">{d.app_progress ?? 0}%</span>
            </div>
            <Meter actual={d.app_progress ?? 0} target={100} />
          </div>
          <div className="grid grid-cols-4 gap-1">
            <PanelStat label="Completed" value={num(d.app_completed)} tone="good" href="/shreex/product" />
            <PanelStat label="Pending" value={num(d.app_pending)} href="/shreex/product" />
            <PanelStat label="Blocked" value={num(d.app_blocked)} tone={d.app_blocked ? "bad" : "default"} href="/shreex/product" />
            <PanelStat label="Open bugs" value={num(d.app_bugs)} tone={d.app_bugs ? "warn" : "default"} href="/shreex/product" />
          </div>
        </Panel>

        <Panel icon="users" title="Growth & community" desc="Members, influencers, ambassadors, partners">
          <div className="grid grid-cols-4 gap-1">
            <PanelStat label="Members" value={num(d.members_total)} href="/shreex/membership" />
            <PanelStat label="Free" value={num(d.members_free)} href="/shreex/membership" />
            <PanelStat label="Paid" value={num(d.members_paid)} href="/shreex/membership" />
            <PanelStat label="Elite" value={num(d.members_elite)} href="/shreex/membership" />
            <PanelStat label="Influencers" value={num(d.influencers)} href="/shreex/influencers" />
            <PanelStat label="Ambassadors" value={num(d.ambassadors)} href="/shreex/ambassadors" />
            <PanelStat label="Partners" value={num(d.partners)} href="/shreex/partnerships" />
          </div>
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-[11px] text-muted">
              <span>Conversion to paid</span>
              <span className="tabular-nums">{pct(d.member_conversion)}</span>
            </div>
            <Meter actual={d.member_conversion ?? 0} target={100} />
          </div>
        </Panel>

        <Panel icon="broadcast" title="Marketing" desc="Reach, leads and spend across campaigns">
          <div className="grid grid-cols-3 gap-1">
            <PanelStat label="Content published" value={num(d.content_published)} href="/shreex/content" />
            <PanelStat label="Reach" value={num(d.mkt_reach)} href="/shreex/campaigns" />
            <PanelStat label="Leads" value={num(d.mkt_leads)} href="/shreex/campaigns" />
            <PanelStat label="Conversions" value={num(d.mkt_conversions)} href="/shreex/campaigns" />
            <PanelStat label="Spend" value={inrCompact(d.mkt_spend)} tone="warn" href="/shreex/campaigns" />
            <PanelStat
              label="ROI"
              value={d.mkt_spend > 0 ? `${(((d.mkt_revenue - d.mkt_spend) / d.mkt_spend) * 100).toFixed(0)}%` : "No data yet"}
              tone={d.mkt_revenue >= d.mkt_spend ? "good" : "bad"}
              href="/shreex/analytics"
            />
          </div>
        </Panel>

        <Panel icon="calendar" title="Events" desc="Live events system + Shreex financials">
          <div className="grid grid-cols-4 gap-1">
            <PanelStat label="Upcoming" value={num(d.events_upcoming)} href="/shreex/events" />
            <PanelStat label="Completed" value={num(d.events_completed)} href="/shreex/events" />
            <PanelStat label="Registrations" value={num(d.events_registrations)} tone="brand" href="/shreex/events" />
            <PanelStat label="Attendance" value={num(d.events_attendance)} href="/shreex/events" />
            <PanelStat label="Revenue" value={inrCompact(d.event_revenue)} tone="good" href="/shreex/events" />
            <PanelStat label="Cost" value={inrCompact(d.event_cost)} tone="warn" href="/shreex/events" />
            <PanelStat label="Profit" value={inrCompact(eventProfit)} tone={eventProfit >= 0 ? "good" : "bad"} href="/shreex/events" />
          </div>
        </Panel>

        <Panel icon="trophy" title="Sales pipeline" desc="Weighted = expected revenue × probability">
          <div className="grid grid-cols-4 gap-1">
            <PanelStat label="Leads" value={num(d.leads_total)} href="/shreex/crm" />
            <PanelStat label="Qualified" value={num(d.leads_qualified)} href="/shreex/crm" />
            <PanelStat label="Proposals" value={num(d.leads_proposal)} href="/shreex/crm" />
            <PanelStat label="Negotiations" value={num(d.leads_negotiation)} href="/shreex/crm" />
            <PanelStat label="Pipeline" value={inrCompact(d.pipeline_value)} href="/shreex/crm" />
            <PanelStat label="Weighted" value={inrCompact(d.weighted_pipeline)} tone="brand" href="/shreex/crm" />
            <PanelStat label="Won" value={num(d.deals_won)} tone="good" href="/shreex/crm" />
            <PanelStat label="Lost" value={num(d.deals_lost)} tone="bad" href="/shreex/crm" />
          </div>
        </Panel>

        <Panel icon="medal" title="People" desc="Team, hiring and KPI achievement">
          <div className="grid grid-cols-3 gap-1">
            <PanelStat label="Employees" value={num(d.employees)} href="/shreex/people" />
            <PanelStat label="Open positions" value={num(d.open_positions)} href="/shreex/hiring" />
            <PanelStat label="Planned hires" value={num(d.planned_hires)} href="/shreex/hiring" />
            <PanelStat label="Monthly payroll" value={inrCompact(d.monthly_payroll)} tone="warn" href="/shreex/people" />
            <PanelStat label="Hiring cost" value={inrCompact(d.hiring_cost)} href="/shreex/hiring" />
          </div>
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-[11px] text-muted">
              <span>KPI achievement</span>
              <span className="tabular-nums">{d.emp_kpi_achievement ?? 0}%</span>
            </div>
            <Meter actual={d.emp_kpi_achievement ?? 0} target={100} />
          </div>
        </Panel>

        <Panel icon="bell" title="Control center" desc="What needs attention right now" tone="warn">
          <div className="grid grid-cols-4 gap-1">
            <PanelStat label="Overdue tasks" value={num(d.tasks_overdue)} tone={d.tasks_overdue > 0 ? "bad" : "good"} href={`${T}?view=overdue`} />
            <PanelStat label="Critical tasks" value={num(d.tasks_critical)} tone={d.tasks_critical > 0 ? "bad" : "default"} href={T} />
            <PanelStat label="Blocked" value={num(d.tasks_blocked)} tone={d.tasks_blocked > 0 ? "bad" : "default"} href={`${T}?view=blocked`} />
            <PanelStat label="Open risks" value={num(d.risks_open)} tone={d.risks_critical > 0 ? "warn" : "default"} href="/shreex/risks" />
            <PanelStat label="Pending approvals" value={num(d.approvals_pending)} tone={d.approvals_pending > 0 ? "warn" : "default"} href="/shreex/approvals" />
            <PanelStat label="Expiring contracts" value={num(d.contracts_expiring)} tone={d.contracts_expiring > 0 ? "warn" : "default"} href="/shreex/alerts" />
            <PanelStat label="Dependencies" value={num(d.deps_open)} href="/shreex/dependencies" />
            <PanelStat label="Due today" value={num(d.tasks_due_today)} tone={d.tasks_due_today > 0 ? "warn" : "default"} href="/shreex/alerts" />
          </div>
        </Panel>
      </div>
      </div>

      <SectionHeading title="Marketing & acquisition" />
      <div className="mb-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <BarList title="Leads by channel" desc="Which channel generates the most leads" data={leadsByChannel} emptyHint="Add campaigns with actual leads." />
        <BarList title="Campaign ROI" desc="(Revenue − spend) ÷ spend" data={roi} color="#10b981" emptyHint="Log campaign spend and revenue." />
        <BarList title="Content leads by platform" data={contentLeads} color="#8b5cf6" emptyHint="Log content leads." />
        <BarList title="Leads by source" data={leadsBySource} color="#ec4899" emptyHint="Add CRM leads with a source." />
        <BarList title="Influencer conversions" data={inflConv} color="#f59e0b" emptyHint="Track influencer conversions." />
        <BarList title="Ambassador members acquired" data={ambMembers} color="#06b6d4" emptyHint="Track ambassador results." />
      </div>

      <SectionHeading title="Revenue & pipeline" />
      <div className="mb-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <BarList title="Event revenue" desc="Which events generate the most revenue" data={eventRevenue} color="#22c55e" emptyHint="Revenue appears as tickets sell." />
        <BarList title="Pipeline by stage" desc="Expected revenue by stage" data={pipelineByStage} color="#ef4444" emptyHint="Add CRM leads." />
      </div>

      <SectionHeading title="People" desc="Objective KPI achievement — no rankings, just progress" />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <BarList title="KPI achievement" desc="Actual ÷ target" data={empAchievement} color="#a855f7" emptyHint="Add employee KPI targets and actuals." />
      </div>
    </>
  );
}
