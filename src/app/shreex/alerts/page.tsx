import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, EmptyState } from "@/components/os/ui";
import { shortDate, inr, pct } from "@/lib/bos";

export const metadata = { title: "Alerts · Shreex" };

type Alert = { tone: "bad" | "warn"; text: string; href: string; when?: string };

const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

export default async function AlertsPage() {
  const supabase = await createClient();
  const t = today();
  const soon = inDays(7);
  const soon30 = inDays(30);

  const [
    { data: tasks }, { data: approvals }, { data: risks }, { data: campaigns },
    { data: legal }, { data: vendors }, { data: goals }, { data: kpis },
    { data: events }, { data: regs }, { data: cashflow }, { data: hiring },
  ] = await Promise.all([
    supabase.from("tasks").select("id,title,due_date,status,budget,actual_cost"),
    supabase.from("approvals").select("id,request_title,decision"),
    supabase.from("risks").select("id,risk,risk_score,status"),
    supabase.from("campaigns").select("id,name,budget,actual_spend"),
    supabase.from("legal_items").select("id,requirement,expiry_date,due_date,status"),
    supabase.from("vendors").select("id,name,end_date"),
    supabase.from("goals").select("id,objective,end_date,status"),
    supabase.from("employee_kpis").select("kpi_name,target,actual,employee_id"),
    supabase.from("events").select("id,title,date,status,capacity"),
    supabase.from("registrations").select("event_id,status"),
    supabase.from("cashflow_months").select("*").eq("scenario", "base").order("month", { ascending: false }).limit(1),
    supabase.from("hiring_plan").select("id,role,target_month,status"),
  ]);

  const alerts: { group: string; items: Alert[] }[] = [];
  const add = (group: string, items: Alert[]) => items.length && alerts.push({ group, items });
  const openTask = (s: string) => s !== "completed" && s !== "cancelled";

  add("Overdue tasks", (tasks ?? [])
    .filter((x) => x.due_date && x.due_date < t && openTask(x.status))
    .map((x) => ({ tone: "bad" as const, text: x.title, href: "/shreex/tasks?view=overdue", when: shortDate(x.due_date) })));

  add("Blocked tasks", (tasks ?? [])
    .filter((x) => x.status === "blocked")
    .map((x) => ({ tone: "warn" as const, text: x.title, href: "/shreex/tasks?view=blocked" })));

  add("Budget overruns", [
    ...(tasks ?? []).filter((x) => (x.actual_cost ?? 0) > (x.budget ?? 0) && (x.budget ?? 0) > 0)
      .map((x) => ({ tone: "warn" as const, text: `${x.title} — spent ${inr(x.actual_cost)} of ${inr(x.budget)}`, href: "/shreex/tasks" })),
    ...(campaigns ?? []).filter((x) => (x.actual_spend ?? 0) > (x.budget ?? 0) && (x.budget ?? 0) > 0)
      .map((x) => ({ tone: "warn" as const, text: `${x.name} — spent ${inr(x.actual_spend)} of ${inr(x.budget)}`, href: "/shreex/campaigns" })),
  ]);

  add("Missed KPIs", (kpis ?? [])
    .filter((k) => Number(k.target ?? 0) > 0 && Number(k.actual ?? 0) < Number(k.target ?? 0))
    .map((k) => ({ tone: "warn" as const, text: `${k.kpi_name} — ${k.actual ?? 0} of ${k.target} (${pct((Number(k.actual ?? 0) / Number(k.target)) * 100)})`, href: "/shreex/empkpis" })));

  add("Pending approvals", (approvals ?? [])
    .filter((x) => x.decision === "pending")
    .map((x) => ({ tone: "warn" as const, text: x.request_title, href: "/shreex/approvals" })));

  add("Critical risks", (risks ?? [])
    .filter((x) => (x.risk_score ?? 0) >= 15 && x.status !== "completed" && x.status !== "cancelled")
    .map((x) => ({ tone: "bad" as const, text: `${x.risk} (score ${x.risk_score})`, href: "/shreex/risks" })));

  // Registration / attendance per event
  const regCount = new Map<string, number>();
  const attCount = new Map<string, number>();
  for (const r of regs ?? []) {
    if (r.status === "registered" || r.status === "attended") regCount.set(r.event_id, (regCount.get(r.event_id) ?? 0) + 1);
    if (r.status === "attended") attCount.set(r.event_id, (attCount.get(r.event_id) ?? 0) + 1);
  }
  add("Low registration", (events ?? [])
    .filter((e) => e.status === "published" && e.date >= t && e.date <= soon30 && (e.capacity ?? 0) > 0 && (regCount.get(e.id) ?? 0) / e.capacity < 0.3)
    .map((e) => ({ tone: "warn" as const, text: `${e.title} — ${regCount.get(e.id) ?? 0}/${e.capacity} registered`, href: "/shreex/events", when: shortDate(e.date) })));

  add("Low attendance", (events ?? [])
    .filter((e) => e.status === "completed" && (regCount.get(e.id) ?? 0) > 0 && (attCount.get(e.id) ?? 0) / (regCount.get(e.id) ?? 1) < 0.5)
    .map((e) => ({ tone: "warn" as const, text: `${e.title} — ${attCount.get(e.id) ?? 0}/${regCount.get(e.id) ?? 0} attended`, href: "/shreex/events" })));

  // Cash-flow warning (runway < 3 months)
  const cf = (cashflow ?? [])[0];
  if (cf) {
    const outflow = cf.marketing_spend + cf.event_cost + cf.payroll + cf.hiring_cost + cf.technology_cost + cf.other_expenses;
    const closing = cf.opening_cash + cf.revenue_forecast - outflow;
    const burn = Math.max(outflow - cf.revenue_forecast, 0);
    if (burn > 0 && closing / burn < 3) {
      add("Cash flow warning", [{ tone: "bad", text: `Runway ~${(closing / burn).toFixed(1)} months at current burn`, href: "/shreex/finance" }]);
    }
  }

  add("Upcoming deadlines (7 days)", [
    ...(goals ?? []).filter((x) => x.end_date && x.end_date >= t && x.end_date <= soon && x.status !== "completed")
      .map((x) => ({ tone: "warn" as const, text: x.objective, href: "/shreex/roadmap", when: shortDate(x.end_date) })),
    ...(legal ?? []).filter((x) => x.due_date && x.due_date >= t && x.due_date <= soon && x.status !== "completed")
      .map((x) => ({ tone: "warn" as const, text: x.requirement, href: "/shreex/legal", when: shortDate(x.due_date) })),
  ]);

  add("Hiring deadlines (30 days)", (hiring ?? [])
    .filter((h) => h.target_month && h.target_month >= t && h.target_month <= soon30 && h.status !== "completed" && h.status !== "cancelled")
    .map((h) => ({ tone: "warn" as const, text: `Hire: ${h.role}`, href: "/shreex/hiring", when: shortDate(h.target_month) })));

  add("Expiring contracts (30 days)", [
    ...(legal ?? []).filter((x) => x.expiry_date && x.expiry_date >= t && x.expiry_date <= soon30)
      .map((x) => ({ tone: "warn" as const, text: `${x.requirement} expires`, href: "/shreex/legal", when: shortDate(x.expiry_date) })),
    ...(vendors ?? []).filter((x) => x.end_date && x.end_date >= t && x.end_date <= soon30)
      .map((x) => ({ tone: "warn" as const, text: `${x.name} contract ends`, href: "/shreex/vendors", when: shortDate(x.end_date) })),
  ]);

  const total = alerts.reduce((a, g) => a + g.items.length, 0);

  return (
    <>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-fg">Alerts</h1>
        <p className="text-sm text-muted">
          {total > 0 ? `${total} thing${total === 1 ? "" : "s"} need attention.` : "Everything's on track."}
        </p>
      </div>

      {total === 0 ? (
        <EmptyState title="No alerts 🎉" hint="No overdue work, overruns, missed KPIs, low turnout, cash risk or expiries." />
      ) : (
        <div className="space-y-6">
          {alerts.map((g) => (
            <div key={g.group}>
              <h2 className="mb-2 font-display text-sm font-semibold text-fg">
                {g.group} <span className="text-faint">({g.items.length})</span>
              </h2>
              <Card className="p-0">
                <ul className="divide-y divide-line">
                  {g.items.map((a, i) => (
                    <li key={i}>
                      <Link href={a.href} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2">
                        <span className="flex items-center gap-2 text-sm text-fg">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${a.tone === "bad" ? "bg-red-500" : "bg-amber-500"}`} />
                          {a.text}
                        </span>
                        {a.when && <span className="shrink-0 text-xs text-muted">{a.when}</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
