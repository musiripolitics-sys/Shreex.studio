import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { readTasks } from "@/lib/os-tasks";
import { KpiCard, EmptyState } from "@/components/os/ui";
import { DashboardFilters } from "@/components/os/DashboardFilters";
import { AttentionBand, type AttentionItem } from "@/components/os/AttentionBand";
import { SectionOverview, type SectionCard } from "@/components/os/SectionOverview";
import { type SectionStatus } from "@/lib/bos-sections";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import {
  EmployeeDashboard,
  type MyTask,
  type MyGoal,
  type MyKpi,
} from "../EmployeeDashboard";
import {
  inrCompact,
  num,
  pct,
  type DashboardSummary,
} from "@/lib/bos";

export const metadata = { title: "Executive Dashboard · Shreex" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const isoYearStart = () => `${new Date().getFullYear()}-01-01`;
const isoToday = () => new Date().toISOString().slice(0, 10);
const s = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

/** Whole days between a past date and today. Never negative. */
function daysLate(date: string | null): number | null {
  if (!date) return null;
  const diff = Date.now() - new Date(date).getTime();
  return diff <= 0 ? null : Math.floor(diff / 86_400_000);
}

const OPEN_STATUSES = "(completed,cancelled)";

export default async function ExecutiveDashboard({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const from = s(sp.from) || isoYearStart();
  const to = s(sp.to) || isoToday();
  const preset = s(sp.preset) || "year";
  const owner = s(sp.owner);
  const workstream = s(sp.workstream);

  const supabase = await createClient();
  const today = isoToday();

  // An employee opens the OS to ask "what do I have to do", not "how is the
  // business doing". They get their own work along time instead of the
  // executive view, and see nothing that is not assigned to them.
  if (!(await isAdmin())) {
    return <MyDashboard />;
  }

  const [
    { data, error },
    { data: owners },
    { data: workstreams },
    sectionRes,
    lateTasksRes,
    lateGoalsRes,
    approvalsRes,
    reviewsRes,
    risksRes,
  ] = await Promise.all([
    supabase.rpc("bos_dashboard_summary", {
      p_from: from,
      p_to: to,
      p_owner: owner || null,
      p_workstream: workstream || null,
    }),
    supabase.from("users").select("id,full_name,email").in("primary_role", ["admin", "employee", "event_host"]).order("full_name"),
    supabase.from("workstreams").select("id,name").order("sort_order"),
    // Added by migration 0011 — absent on a database that hasn't run it yet,
    // so every consumer below treats an error as "no data", not a crash.
    supabase.rpc("bos_section_status"),
    supabase
      .from("tasks")
      .select("id,title,due_date,owner_id")
      .lt("due_date", today)
      .not("status", "in", OPEN_STATUSES)
      .order("due_date", { ascending: true })
      .limit(8),
    supabase
      .from("goals")
      .select("id,objective,deliverable,end_date,owner_id")
      .lt("end_date", today)
      .not("status", "in", OPEN_STATUSES)
      .order("end_date", { ascending: true })
      .limit(5),
    supabase
      .from("approvals")
      .select("id,request_title,created_at")
      .eq("decision", "pending")
      .order("created_at", { ascending: true })
      .limit(5),
    supabase
      .from("task_reviews")
      .select("task_id,created_at,tasks(title)")
      .eq("outcome", "pending")
      .order("created_at", { ascending: true })
      .limit(5),
    // Critical risks count towards "needs attention", so they have to appear in
    // the band too — otherwise it reads "nothing is overdue" next to a 3.
    // Threshold matches bos_dashboard_summary: risk_score >= 15.
    supabase
      .from("risks")
      .select("id,risk,due_date,owner_id,risk_score")
      .gte("risk_score", 15)
      .not("status", "in", OPEN_STATUSES)
      .order("risk_score", { ascending: false })
      .limit(5),
  ]);

  const filterProps = {
    from, to, preset, owner, workstream,
    owners: (owners as { id: string; full_name: string | null; email: string | null }[]) ?? [],
    workstreams: (workstreams as { id: string; name: string }[]) ?? [],
  };

  if (error) {
    return (
      <>
        <Header {...filterProps} />
        <EmptyState
          title="Dashboard couldn't load"
          hint={error.message.includes("bos_dashboard_summary")
            ? "Run migrations 0007–0010 in Supabase, then reload."
            : error.message}
        />
      </>
    );
  }

  const ownerName = new Map(
    ((owners as { id: string; full_name: string | null; email: string | null }[]) ?? []).map(
      (o) => [o.id, o.full_name || o.email || null] as const,
    ),
  );

  const sections = (sectionRes.error ? null : (sectionRes.data as SectionStatus)) ?? null;

  const attention: AttentionItem[] = [
    ...((lateTasksRes.data as { id: string; title: string; due_date: string; owner_id: string | null }[]) ?? []).map(
      (t): AttentionItem => ({
        id: t.id,
        kind: "Task",
        title: t.title,
        href: `/shreex/tasks?view=overdue`,
        daysLate: daysLate(t.due_date),
        owner: t.owner_id ? ownerName.get(t.owner_id) : null,
      }),
    ),
    ...((lateGoalsRes.data as { id: string; objective: string | null; deliverable: string | null; end_date: string; owner_id: string | null }[]) ?? []).map(
      (g): AttentionItem => ({
        id: g.id,
        kind: "Goal",
        title: g.deliverable?.trim() || g.objective || "Untitled goal",
        href: "/shreex/roadmap",
        daysLate: daysLate(g.end_date),
        owner: g.owner_id ? ownerName.get(g.owner_id) : null,
      }),
    ),
    ...((approvalsRes.data as { id: string; request_title: string | null; created_at: string }[]) ?? []).map(
      (a): AttentionItem => ({
        id: a.id,
        kind: "Approval",
        title: a.request_title || "Untitled request",
        href: "/shreex/approvals",
        daysLate: null,
        note: "Pending",
      }),
    ),
    // PostgREST embeds a to-one foreign key as an object, not an array, so
    // indexing [0] left every one of these reading "Review a completed task"
    // instead of naming it. Accept either shape.
    ...((reviewsRes.data as { task_id: string; tasks: { title: string } | { title: string }[] | null }[] | null) ?? []).map(
      (r): AttentionItem => {
        const taskTitle = (Array.isArray(r.tasks) ? r.tasks[0] : r.tasks)?.title;
        return {
        id: r.task_id,
        kind: "Review",
        title: taskTitle ? `Review "${taskTitle}"` : "Review a completed task",
        href: "/shreex/reviews?tab=tasks",
        daysLate: null,
        note: "Unwritten",
        };
      },
    ),
    ...((risksRes.data as { id: string; risk: string; due_date: string | null; owner_id: string | null; risk_score: number }[] | null) ?? []).map(
      (r): AttentionItem => ({
        id: r.id,
        kind: "Risk",
        title: r.risk,
        href: "/shreex/risks",
        daysLate: daysLate(r.due_date),
        owner: r.owner_id ? ownerName.get(r.owner_id) : null,
        note: `Score ${r.risk_score}`,
      }),
    ),
  ]
    // Worst first: anything with a day count outranks anything merely waiting.
    .sort((a, b) => (b.daysLate ?? -1) - (a.daysLate ?? -1))
    .slice(0, 10);

  const d = (data ?? {}) as DashboardSummary;
  const netCash = (d.revenue_actual ?? 0) - (d.expenses_total ?? 0);

  const FIN = "/shreex/finance";

  // ── One card per OS section ──────────────────────────────────────────────
  // Each section gets a single number and a traffic light. Research on
  // executive dashboards is consistent that a primary view should carry 5-9
  // metrics, not the 90 this page used to show; the detail now lives one click
  // away on each section's own page.
  const sec = (key: string) => sections?.[key];
  const openOf = (key: string) => sec(key)?.open ?? 0;
  const overdueOf = (key: string) => sec(key)?.overdue ?? 0;
  const totalOf = (key: string) => sec(key)?.total ?? 0;

  /** Red when something is late, amber when something is waiting, grey when the section is untouched. */
  const light = (
    total: number,
    overdue: number,
    waiting = 0,
  ): SectionCard["tone"] =>
    total === 0 ? "empty" : overdue > 0 ? "action" : waiting > 0 ? "watch" : "ok";

  /** Pluralises a countable noun. Words that are already past participles
   *  ("published", "written") take no plural, so they are passed through. */
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const count = (n: number, word: string) => `${n} ${word}`;

  const planOverdue = overdueOf("tasks") + overdueOf("roadmap");
  const govWaiting = d.approvals_pending + d.risks_critical;
  const marketingDue = overdueOf("content") + overdueOf("campaigns");

  const sectionCards: SectionCard[] = [
    {
      key: "plan", label: "Plan", icon: "rocket", href: "/shreex/roadmap",
      value: num(openOf("tasks")), unit: "open tasks",
      tone: light(totalOf("tasks"), planOverdue, d.tasks_blocked),
      state: totalOf("tasks") === 0 ? "nothing planned"
        : planOverdue > 0 ? `${planOverdue} overdue`
        : d.tasks_blocked > 0 ? `${d.tasks_blocked} blocked` : "on track",
    },
    {
      key: "events", label: "Events", icon: "calendar", href: "/shreex/events",
      value: num(d.events_upcoming), unit: "upcoming",
      tone: light(d.events_upcoming + d.events_completed, 0, d.events_upcoming === 0 ? 1 : 0),
      state: d.events_upcoming + d.events_completed === 0 ? "none yet"
        : d.events_upcoming === 0 ? "nothing scheduled"
        : `${plural(d.events_registrations, "registration")}`,
    },
    {
      key: "money", label: "Money", icon: "trophy", href: FIN,
      value: inrCompact(d.revenue_actual), unit: "revenue",
      tone: d.revenue_actual === 0 && d.expenses_total === 0 ? "empty"
        : netCash < 0 ? "watch" : "ok",
      state: d.revenue_actual === 0 && d.expenses_total === 0 ? "no entries yet"
        : netCash < 0 ? `${inrCompact(Math.abs(netCash))} negative` : "cash positive",
    },
    {
      key: "grow", label: "Grow", icon: "users", href: "/shreex/membership",
      value: num(d.members_total), unit: "members",
      tone: light(d.members_total + d.leads_total, 0, d.leads_total === 0 ? 1 : 0),
      state: d.members_total + d.leads_total === 0 ? "no members or leads"
        : d.leads_total === 0 ? "no pipeline"
        : `${inrCompact(d.weighted_pipeline)} weighted`,
    },
    {
      key: "marketing", label: "Marketing", icon: "broadcast", href: "/shreex/campaigns",
      value: num(totalOf("content")), unit: "content items",
      tone: light(totalOf("content") + totalOf("campaigns"), marketingDue, d.content_published === 0 ? 1 : 0),
      state: totalOf("content") + totalOf("campaigns") === 0 ? "no campaigns yet"
        : marketingDue > 0 ? `${marketingDue} overdue`
        : count(d.content_published, "published"),
    },
    {
      key: "team", label: "Team", icon: "medal", href: "/shreex/people",
      value: num(d.employees), unit: "people",
      tone: light(d.employees + d.planned_hires, 0, d.open_positions),
      state: d.employees + d.planned_hires === 0 ? "no team recorded"
        : d.open_positions > 0 ? `${plural(d.open_positions, "role")} open` : "fully staffed",
    },
    {
      key: "product", label: "Product", icon: "code", href: "/shreex/product",
      value: `${d.app_progress ?? 0}%`, unit: "built",
      tone: light(totalOf("product"), d.app_blocked, d.app_bugs),
      state: totalOf("product") === 0 ? "no modules tracked"
        : d.app_blocked > 0 ? `${plural(d.app_blocked, "module")} blocked`
        : d.app_bugs > 0 ? `${plural(d.app_bugs, "bug")} open` : "nothing blocked",
    },
    {
      key: "govern", label: "Govern", icon: "bell", href: "/shreex/risks",
      value: num(d.risks_open), unit: "open risks",
      tone: light(totalOf("risks") + totalOf("legal"), overdueOf("legal"), govWaiting),
      state: totalOf("risks") + totalOf("legal") === 0 ? "nothing registered"
        : overdueOf("legal") > 0 ? `${overdueOf("legal")} legal overdue`
        : d.approvals_pending > 0 ? `${plural(d.approvals_pending, "approval")} waiting`
        : d.risks_critical > 0 ? `${d.risks_critical} critical` : "under control",
    },
    {
      key: "insights", label: "Insights", icon: "clock", href: "/shreex/reviews",
      value: num(totalOf("kpis")), unit: "KPIs defined",
      tone: light(totalOf("kpis") + totalOf("reviews"), overdueOf("task_reviews"), totalOf("reviews") === 0 ? 1 : 0),
      state: totalOf("kpis") + totalOf("reviews") === 0 ? "not instrumented"
        : overdueOf("task_reviews") > 0 ? `${overdueOf("task_reviews")} reviews unwritten`
        : `${count(totalOf("reviews"), totalOf("reviews") === 1 ? "review" : "reviews")} written`,
    },
  ];

  const attentionCount =
    d.tasks_overdue + d.risks_critical + d.approvals_pending + overdueOf("task_reviews");


  return (
    <>
      <Header {...filterProps} />

      {/* ── 1. What is late, by name. Five at most; the rest are on Alerts. ── */}
      <AttentionBand items={attention.slice(0, 5)} />

      {/* ── 2. The four numbers worth checking daily ── */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Net cash movement"
          value={inrCompact(netCash)}
          sub={`${inrCompact(d.revenue_actual)} in · ${inrCompact(d.expenses_total)} out`}
          href={FIN}
          tone={netCash >= 0 ? "good" : "bad"}
        />
        <KpiCard
          label="Runway"
          value={d.runway_months != null ? `${d.runway_months} mo` : "No burn yet"}
          sub={d.monthly_burn > 0 ? `${inrCompact(d.monthly_burn)} a month` : undefined}
          href={FIN}
          tone={d.runway_months != null && d.runway_months < 3 ? "bad" : "default"}
        />
        <KpiCard
          label="Members"
          value={num(d.members_total)}
          sub={`${num(d.members_paid)} paid · ${pct(d.member_conversion)} converted`}
          href="/shreex/membership"
        />
        <KpiCard
          label="Needs attention"
          value={num(attentionCount)}
          sub="Overdue, blocked or waiting on you"
          href="/shreex/alerts"
          tone={attentionCount > 0 ? "warn" : "good"}
        />
      </div>

      {/* ── 3. One card per section of the OS, in sidebar order ── */}
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-faint">
          Sections
        </h2>
        <Link href="/shreex/analytics" className="text-xs text-muted hover:text-brand">
          Full breakdown →
        </Link>
      </div>
      <SectionOverview sections={sectionCards} />
    </>
  );
}

/** The employee view: their tasks, their goals, their deadlines, nothing else. */
async function MyDashboard() {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return null;

  const [myTasks, goalsRes, kpisRes, edgesRes, reviewsRes, profileRes] = await Promise.all([
    readTasks<MyTask>(
      (cols) =>
        supabase
          .from("tasks")
          .select(cols)
          .eq("owner_id", user.id)
          .order("due_date", { ascending: true, nullsFirst: false }),
      "id,code,title,goal_id,start_date,due_date,status,priority,estimate_hours,dependency_id",
    ),
    supabase
      .from("goals")
      .select("id,code,objective,end_date,status")
      .eq("owner_id", user.id)
      .order("end_date", { ascending: true, nullsFirst: false }),
    supabase
      .from("employee_kpis")
      .select("kpi_name,target,actual,period")
      .eq("employee_id", user.id)
      .order("period", { ascending: false })
      .limit(6),
    supabase.from("dependencies").select("from_id,to_id"),
    supabase.from("task_reviews").select("task_id").eq("outcome", "pending"),
    supabase.from("users").select("full_name").eq("id", user.id).maybeSingle(),
  ]);

  const tasks = myTasks;
  const mine = new Set(tasks.map((t) => t.id));

  // What each of their tasks is waiting on, but only where the blocker is
  // still unfinished — a satisfied dependency is not worth mentioning.
  const { data: blockers } = await supabase
    .from("tasks")
    .select("id,code,title,status");
  const byId = new Map(
    ((blockers as { id: string; code: string | null; title: string; status: string }[]) ?? []).map(
      (t) => [t.id, t],
    ),
  );
  const blockedTitles: Record<string, string> = {};
  for (const e of (edgesRes.data as { from_id: string | null; to_id: string | null }[]) ?? []) {
    if (!e.from_id || !e.to_id || !mine.has(e.from_id)) continue;
    const on = byId.get(e.to_id);
    if (on && on.status !== "completed") {
      blockedTitles[e.from_id] = `${on.code ?? ""} ${on.title}`.trim();
    }
  }

  const reviewsDue = ((reviewsRes.data as { task_id: string }[]) ?? []).filter((r) =>
    mine.has(r.task_id),
  ).length;

  return (
    <EmployeeDashboard
      name={(profileRes.data as { full_name: string | null } | null)?.full_name ?? ""}
      tasks={tasks}
      goals={(goalsRes.data as MyGoal[]) ?? []}
      kpis={(kpisRes.data as MyKpi[]) ?? []}
      blockedTitles={blockedTitles}
      reviewsDue={reviewsDue}
    />
  );
}

type HeaderProps = React.ComponentProps<typeof DashboardFilters>;

function Header(props: HeaderProps) {
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-bold tracking-tight text-fg">Executive Dashboard</h1>
        <p className="text-xs text-muted">Shreex</p>
      </div>
      <p className="mb-4 max-w-2xl text-sm text-muted">
        What is late, the four numbers worth checking daily, and the state of every
        section. Each card opens the detail behind it.
      </p>
      <DashboardFilters {...props} />
    </div>
  );
}
