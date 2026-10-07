import { createClient } from "@/lib/supabase/server";
import { ReportsClient, type Report } from "./ReportsClient";
import { paiseToRupees } from "@/lib/bos";
import { requireSection } from "@/lib/os-access";

export const metadata = { title: "Reports · Shreex" };

const d = (s: string | null | undefined) => (s ? String(s).slice(0, 10) : "");
const r = (paise: number | null | undefined) => paiseToRupees(Number(paise ?? 0));

export default async function ReportsPage() {
  await requireSection("insights");
  const supabase = await createClient();

  const [
    { data: expenses }, { data: revenue }, { data: campaigns }, { data: events },
    { data: leads }, { data: tasks }, { data: users }, { data: memberships },
    { data: appModules }, { data: partnerships }, { data: employees }, { data: influencers },
    { data: ambassadors }, { data: payments },
  ] = await Promise.all([
    supabase.from("expenses").select("spent_on,category,subcategory,description,vendor,amount,payment_status"),
    supabase.from("revenue_entries").select("received_on,source,description,amount"),
    supabase.from("campaigns").select("name,channel,campaign_type,budget,actual_spend,actual_leads,actual_conversions,revenue_generated,status"),
    supabase.from("events").select("title,category,date,city,status,capacity,spots_left"),
    supabase.from("leads").select("name,company,source,stage,expected_revenue,probability,weighted_revenue"),
    supabase.from("tasks").select("title,owner_id,frequency,due_date,status,priority,budget,actual_cost"),
    supabase.from("users").select("id,full_name"),
    supabase.from("memberships").select("tier,status,source,started_at"),
    supabase.from("app_modules").select("module,feature,environment,status,priority,bug_count,target_date"),
    supabase.from("partnerships").select("name,partner_type,stage,expected_value,actual_value,status,created_at"),
    supabase.from("employee_profiles").select("user_id,title,department,monthly_cost,status,start_date"),
    supabase.from("influencers").select("name,platform,category,followers,conversions,members_generated"),
    supabase.from("ambassadors").select("student_name,college,city,members_acquired,registrations,status"),
    supabase.from("payments").select("amount,status").eq("status", "paid"),
  ]);

  const uName = new Map((users ?? []).map((u) => [u.id, u.full_name]));

  // Business performance summary (no date column)
  const totalRev = (payments ?? []).reduce((a, p) => a + (p.amount ?? 0), 0) + (revenue ?? []).reduce((a, x) => a + (x.amount ?? 0), 0);
  const totalExp = (expenses ?? []).reduce((a, e) => a + (e.amount ?? 0), 0);
  const summary: (string | number)[][] = [
    ["Total revenue (₹)", r(totalRev)],
    ["Total expenses (₹)", r(totalExp)],
    ["Net (₹)", r(totalRev - totalExp)],
    ["Active members", (memberships ?? []).filter((m) => m.status === "active").length],
    ["Events", (events ?? []).length],
    ["Open leads", (leads ?? []).filter((l) => l.stage !== "won" && l.stage !== "lost").length],
    ["Campaigns", (campaigns ?? []).length],
    ["Employees", (employees ?? []).filter((e) => e.status === "active").length],
  ];

  const reports: Report[] = [
    { key: "business", title: "Business Performance", columns: ["Metric", "Value"], rows: summary },
    {
      key: "finance", title: "Finance", dateIdx: 0,
      columns: ["Date", "Type", "Category", "Description", "Vendor", "Amount (₹)", "Status"],
      rows: [
        ...(expenses ?? []).map((e) => [d(e.spent_on), "Expense", `${e.category}${e.subcategory ? " / " + e.subcategory : ""}`, e.description ?? "", e.vendor ?? "", -r(e.amount), e.payment_status]),
        ...(revenue ?? []).map((x) => [d(x.received_on), "Revenue", x.source, x.description ?? "", "", r(x.amount), "received"]),
      ],
    },
    {
      key: "marketing", title: "Marketing",
      columns: ["Campaign", "Channel", "Type", "Budget (₹)", "Spend (₹)", "Leads", "Conversions", "Revenue (₹)", "Status"],
      rows: (campaigns ?? []).map((c) => [c.name, c.channel ?? "", c.campaign_type ?? "", r(c.budget), r(c.actual_spend), c.actual_leads ?? 0, c.actual_conversions ?? 0, r(c.revenue_generated), c.status]),
    },
    {
      key: "events", title: "Events", dateIdx: 2,
      columns: ["Event", "Category", "Date", "City", "Status", "Capacity", "Spots left"],
      rows: (events ?? []).map((e) => [e.title, e.category, d(e.date), e.city, e.status, e.capacity, e.spots_left]),
    },
    {
      key: "membership", title: "Membership", dateIdx: 3,
      columns: ["Tier", "Status", "Source", "Started"],
      rows: (memberships ?? []).map((m) => [m.tier, m.status, m.source ?? "—", d(m.started_at)]),
    },
    {
      key: "sales", title: "Sales / CRM",
      columns: ["Lead", "Company", "Source", "Stage", "Expected (₹)", "Probability %", "Weighted (₹)"],
      rows: (leads ?? []).map((l) => [l.name, l.company ?? "", l.source ?? "", l.stage, r(l.expected_revenue), l.probability ?? 0, r(l.weighted_revenue)]),
    },
    {
      key: "partnerships", title: "Partnerships",
      columns: ["Partner", "Type", "Stage", "Expected (₹)", "Actual (₹)", "Status"],
      rows: (partnerships ?? []).map((p) => [p.name, p.partner_type ?? "", p.stage, r(p.expected_value), r(p.actual_value), p.status]),
    },
    {
      key: "employees", title: "Employees",
      columns: ["Employee", "Title", "Department", "Monthly cost (₹)", "Status"],
      rows: (employees ?? []).map((e) => [uName.get(e.user_id) ?? "—", e.title ?? "", e.department ?? "", r(e.monthly_cost), e.status]),
    },
    {
      key: "application", title: "Application", dateIdx: 5,
      columns: ["Module", "Feature", "Environment", "Status", "Bugs", "Target date"],
      rows: (appModules ?? []).map((a) => [a.module, a.feature ?? "", a.environment, a.status, a.bug_count ?? 0, d(a.target_date)]),
    },
    {
      key: "community", title: "Community",
      columns: ["Type", "Name", "Detail", "Members/Conv"],
      rows: [
        ...(influencers ?? []).map((i) => ["Influencer", i.name, i.platform ?? "", i.members_generated ?? i.conversions ?? 0]),
        ...(ambassadors ?? []).map((a) => ["Ambassador", a.student_name, `${a.college ?? ""} ${a.city ?? ""}`.trim(), a.members_acquired ?? 0]),
      ],
    },
    {
      key: "tasks", title: "Tasks", dateIdx: 3,
      columns: ["Task", "Owner", "Frequency", "Due", "Status", "Priority", "Budget (₹)", "Actual (₹)"],
      rows: (tasks ?? []).map((t) => [t.title, uName.get(t.owner_id ?? "") ?? "", t.frequency, d(t.due_date), t.status, t.priority, r(t.budget), r(t.actual_cost)]),
    },
  ];

  return <ReportsClient reports={reports} />;
}
