import Link from "next/link";
import { Icon } from "@/components/Icon";
import { Card, EmptyState, Meter } from "@/components/os/ui";
import { type BosStatus, type BosPriority } from "@/lib/bos";
import { MyKanban } from "./MyKanban";

export type MyTask = {
  id: string;
  code: string | null;
  title: string;
  goal_id: string | null;
  start_date: string | null;
  due_date: string | null;
  status: BosStatus;
  priority: BosPriority;
  estimate_hours: number | null;
  dependency_id: string | null;
  approval_state: "none" | "pending" | "approved" | "rejected";
};
export type MyGoal = {
  id: string;
  code: string | null;
  objective: string;
  end_date: string | null;
  status: BosStatus;
};
export type MyKpi = { kpi_name: string; target: number | null; actual: number | null; period: string };

const DAY = 86_400_000;
const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Whole days from today until a date. Negative means it has passed. */
function daysUntil(date: string | null): number | null {
  if (!date) return null;
  return Math.round((midnight(new Date(date.slice(0, 10))) - midnight(new Date())) / DAY);
}

/** "3 days late", "due today", "in 2 weeks" — the phrasing an employee needs. */
function countdown(days: number | null): { text: string; tone: "late" | "now" | "soon" | "later" } {
  if (days === null) return { text: "no date", tone: "later" };
  if (days < 0) return { text: `${-days} day${days === -1 ? "" : "s"} late`, tone: "late" };
  if (days === 0) return { text: "due today", tone: "now" };
  if (days === 1) return { text: "due tomorrow", tone: "now" };
  if (days <= 7) return { text: `in ${days} days`, tone: "soon" };
  if (days <= 14) return { text: "in 2 weeks", tone: "later" };
  return { text: `in ${Math.round(days / 7)} weeks`, tone: "later" };
}

const TONE: Record<string, string> = {
  late: "border-red-200 bg-red-50 text-red-700",
  now: "border-amber-200 bg-amber-50 text-amber-700",
  soon: "border-blue-200 bg-blue-50 text-blue-700",
  later: "border-line bg-surface-2 text-muted",
};

/**
 * The employee's own dashboard.
 *
 * The executive dashboard answers "how is the business doing", which is not a
 * question an employee opens the OS to ask. This one answers "what do I have
 * to do, and how long have I got".
 *
 * Where they stand comes first and stays small — four numbers, their goals and
 * their KPIs — and the board takes the rest of the page, because moving work
 * across it is the thing they came to do rather than something to scroll to.
 */
export function EmployeeDashboard({
  name,
  tasks,
  goals,
  kpis,
  blockedTitles,
  reviewsDue,
}: {
  name: string;
  tasks: MyTask[];
  goals: MyGoal[];
  kpis: MyKpi[];
  /** Task id → what it is waiting on, when that thing is not finished. */
  blockedTitles: Record<string, string>;
  reviewsDue: number;
}) {
  const open = tasks.filter((t) => t.status !== "completed" && t.status !== "cancelled");
  const done = tasks.filter((t) => t.status === "completed");

  const withDays = open
    .map((t) => ({ task: t, days: daysUntil(t.due_date) }))
    .sort((a, b) => (a.days ?? 9999) - (b.days ?? 9999));

  const overdue = withDays.filter((r) => r.days !== null && r.days < 0).length;
  const dueThisWeek = withDays.filter((r) => r.days !== null && r.days >= 0 && r.days <= 7).length;
  const blocked = open.filter((t) => blockedTitles[t.id]).length;
  const hoursAhead = open.reduce((a, t) => a + Number(t.estimate_hours ?? 0), 0);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = (name || "").split(" ")[0] || "there";

  return (
    <>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-2xl font-bold tracking-tight text-fg">
          {greeting}, {firstName}
        </h1>
        <p className="text-xs text-muted">
          {new Date().toLocaleDateString("en-IN", {
            weekday: "long", day: "numeric", month: "long",
          })}
        </p>
      </div>
      <p className="mb-5 text-sm text-muted">
        {open.length === 0
          ? "Nothing assigned to you right now."
          : overdue > 0
            ? `${overdue} of your ${open.length} open tasks ${overdue === 1 ? "is" : "are"} already late.`
            : `${open.length} open task${open.length === 1 ? "" : "s"}, ${dueThisWeek} due within the week.`}
      </p>

      {/* ── 1. Where they stand ── */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Mini label="Open tasks" value={open.length} href="/shreex/tasks" />
        <Mini label="Overdue" value={overdue} tone={overdue > 0 ? "bad" : "good"} href="/shreex/tasks?view=overdue" />
        <Mini label="Blocked" value={blocked} tone={blocked > 0 ? "warn" : "good"} href="/shreex/dependencies" />
        <Mini
          label="Hours ahead"
          value={hoursAhead > 0 ? `${hoursAhead}h` : "—"}
          sub={done.length > 0 ? `${done.length} done` : undefined}
          href="/shreex/tasks"
        />
      </div>

      {/* ── 2. Goals and performance, compact ── */}
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold text-fg">
            <Icon name="rocket" className="h-4 w-4 text-faint" strokeWidth={1.8} />
            Your goals
          </h2>
          {goals.length === 0 ? (
            <p className="text-xs text-faint">No goals are assigned to you.</p>
          ) : (
            <div className="space-y-3">
              {goals.map((g) => {
                const mine = tasks.filter((t) => t.goal_id === g.id);
                const finished = mine.filter((t) => t.status === "completed").length;
                const c = countdown(daysUntil(g.end_date));
                return (
                  <Link key={g.id} href="/shreex/roadmap" className="block rounded-xl border border-line p-3 hover:border-brand/40">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 text-sm font-medium leading-snug text-fg">{g.objective}</p>
                      <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${TONE[c.tone]}`}>
                        {c.text}
                      </span>
                    </div>
                    {mine.length > 0 && (
                      <div className="mt-2">
                        <div className="mb-1 flex justify-between text-[10px] text-faint">
                          <span>{finished} of {mine.length} tasks done</span>
                          <span>{Math.round((finished / mine.length) * 100)}%</span>
                        </div>
                        <Meter actual={finished} target={Math.max(1, mine.length)} />
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold text-fg">
            <Icon name="medal" className="h-4 w-4 text-faint" strokeWidth={1.8} />
            Your performance
          </h2>
          {kpis.length === 0 ? (
            <p className="text-xs text-faint">No KPIs set for you yet.</p>
          ) : (
            <div className="space-y-3">
              {kpis.map((k) => {
                const pct = k.target ? Math.round(((k.actual ?? 0) / k.target) * 100) : null;
                return (
                  <div key={`${k.kpi_name}-${k.period}`}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="text-fg">{k.kpi_name}</span>
                      <span className="tabular-nums text-muted">
                        {k.actual ?? 0}{k.target ? ` / ${k.target}` : ""}
                        {pct !== null ? ` · ${pct}%` : ""}
                      </span>
                    </div>
                    <Meter actual={Number(k.actual ?? 0)} target={Number(k.target ?? 1)} />
                  </div>
                );
              })}
            </div>
          )}

          {reviewsDue > 0 && (
            <Link
              href="/shreex/reviews?tab=tasks"
              className="mt-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 hover:border-amber-300"
            >
              <Icon name="clock" className="h-4 w-4 shrink-0" strokeWidth={1.8} />
              {reviewsDue} completed task{reviewsDue === 1 ? "" : "s"} waiting for your review
            </Link>
          )}
        </Card>
      </div>

      {/* ── 3. The board ── */}
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-faint">
          Your board
        </h2>
        <p className="text-[11px] text-faint">Drag a card to move it, or use the menu on it</p>
      </div>
      {tasks.length === 0 ? (
        <EmptyState
          title="No tasks yet"
          hint="When an admin assigns you work it appears on this board."
        />
      ) : (
        <MyKanban tasks={tasks} blockedTitles={blockedTitles} />
      )}
    </>
  );
}

function Mini({
  label, value, sub, tone = "default", href,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "default" | "good" | "bad" | "warn";
  href: string;
}) {
  const colour =
    tone === "bad" ? "text-red-600" : tone === "warn" ? "text-amber-600" : "text-fg";
  return (
    <Link href={href} className="rounded-2xl border border-line bg-surface p-4 shadow-soft transition-colors hover:border-brand/40">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-faint">{label}</p>
      <p className={`mt-1 font-display text-2xl font-bold tabular-nums ${colour}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-faint">{sub}</p>}
    </Link>
  );
}
