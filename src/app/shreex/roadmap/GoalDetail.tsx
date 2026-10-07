"use client";

import { StatusBadge, PriorityBadge, Meter } from "@/components/os/ui";
import { STATUS_META, inr, shortDate } from "@/lib/bos";
import type { Goal, RoadmapTask, TaskEdge, OwnerOption, Workstream } from "./types";

/**
 * The goal, opened as a panel: what it is, where it stands, and every task it
 * produced with who holds it. The same shape as the task panel, one level up —
 * clicking a task here hands off to that panel rather than duplicating it.
 */
export function GoalDetail({
  goal,
  tasks,
  edges,
  owners,
  workstreams,
  onClose,
  onOpenTask,
  onEdit,
}: {
  goal: Goal;
  tasks: RoadmapTask[];
  edges: TaskEdge[];
  owners: OwnerOption[];
  workstreams: Workstream[];
  onClose: () => void;
  onOpenTask: (id: string) => void;
  onEdit: (g: Goal) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const ownerName = (id: string | null) => {
    const o = owners.find((x) => x.id === id);
    return o ? o.full_name || o.email || "Unknown" : "Unassigned";
  };
  const ws = workstreams.find((w) => w.id === goal.workstream_id);

  const done = tasks.filter((t) => t.status === "completed").length;
  const overdue = tasks.filter(
    (t) =>
      t.due_date &&
      t.due_date.slice(0, 10) < today &&
      t.status !== "completed" &&
      t.status !== "cancelled",
  ).length;
  const hours = tasks.reduce((a, t) => a + Number(t.estimate_hours ?? 0), 0);

  // Who is carrying this goal, and how much of it.
  const byOwner = new Map<string, number>();
  for (const t of tasks) byOwner.set(t.owner_id ?? "", (byOwner.get(t.owner_id ?? "") ?? 0) + 1);

  const blockerCount = (id: string) =>
    edges.filter((e) => e.from_id === id).filter((e) => {
      const on = tasks.find((t) => t.id === e.to_id);
      return !on || on.status !== "completed";
    }).length;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={goal.objective}
        className="relative my-auto w-full max-w-4xl overflow-hidden rounded-2xl border border-line bg-surface shadow-soft"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-[11px] text-faint">
              <span className="font-mono">{goal.code ?? "Goal"}</span>
              {ws && (
                <>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: ws.color ?? "#999" }} />
                    {ws.name}
                  </span>
                </>
              )}
            </p>
            <h2 className="mt-1 font-display text-lg font-bold text-fg">{goal.objective}</h2>
            {goal.deliverable && <p className="mt-0.5 text-sm text-muted">{goal.deliverable}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => onEdit(goal)}
              className="rounded-full border border-line px-3 py-1.5 text-xs font-medium text-muted hover:border-brand hover:text-brand"
            >
              Edit goal
            </button>
            <button
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-ink-2 hover:text-fg"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        <div className="grid gap-0 md:grid-cols-[1fr_240px]">
          <div className="min-w-0 space-y-5 px-6 py-5">
            <section>
              <div className="mb-1.5 flex items-baseline justify-between">
                <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
                  Progress
                </h3>
                <span className="text-xs tabular-nums text-muted">
                  {done} of {tasks.length} done
                  {overdue > 0 && <span className="ml-2 font-semibold text-red-600">{overdue} overdue</span>}
                </span>
              </div>
              <Meter actual={done} target={Math.max(1, tasks.length)} />
            </section>

            <section>
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
                Tasks ({tasks.length})
              </h3>
              {tasks.length === 0 ? (
                <p className="text-xs text-faint">
                  No tasks yet. Use <span className="font-medium">Create tasks from goals</span> on the
                  roadmap to turn this into work.
                </p>
              ) : (
                <div className="divide-y divide-line/60 rounded-xl border border-line">
                  {tasks.map((t) => {
                    const late =
                      !!t.due_date &&
                      t.due_date.slice(0, 10) < today &&
                      t.status !== "completed" &&
                      t.status !== "cancelled";
                    const waiting = blockerCount(t.id);
                    return (
                      <div key={t.id} className="flex items-start gap-3 px-3 py-2.5">
                        <span className="mt-0.5 w-12 shrink-0 font-mono text-[10px] text-faint">{t.code}</span>
                        <button
                          onClick={() => onOpenTask(t.id)}
                          className="min-w-0 flex-1 text-left text-sm leading-snug text-fg hover:text-brand hover:underline"
                          style={{
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                          }}
                        >
                          {t.title}
                        </button>
                        {waiting > 0 && (
                          <span className="mt-0.5 shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                            waits on {waiting}
                          </span>
                        )}
                        <span className="mt-0.5 hidden w-24 shrink-0 truncate text-[11px] text-muted sm:inline">
                          {ownerName(t.owner_id)}
                        </span>
                        {t.estimate_hours != null && (
                          <span className="mt-0.5 hidden w-8 shrink-0 text-right text-[11px] tabular-nums text-faint sm:inline">
                            {t.estimate_hours}h
                          </span>
                        )}
                        <span
                          className={`mt-0.5 hidden w-20 shrink-0 text-[11px] tabular-nums md:inline ${
                            late ? "font-semibold text-red-600" : "text-muted"
                          }`}
                        >
                          {shortDate(t.due_date)}
                        </span>
                        <PriorityBadge priority={t.priority} />
                        <StatusBadge status={t.status} />
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {byOwner.size > 0 && (
              <section>
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
                  Who is carrying it
                </h3>
                <div className="flex flex-wrap gap-2">
                  {[...byOwner.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .map(([id, n]) => (
                      <span
                        key={id || "unassigned"}
                        className="rounded-full border border-line px-2.5 py-1 text-[11px] text-muted"
                      >
                        {ownerName(id || null)} · {n}
                      </span>
                    ))}
                </div>
              </section>
            )}

            {goal.notes && (
              <section>
                <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
                  Notes
                </h3>
                <p className="whitespace-pre-wrap text-sm text-muted">{goal.notes}</p>
              </section>
            )}
          </div>

          <aside className="space-y-3.5 border-t border-line bg-surface-2/40 px-5 py-5 text-sm md:border-l md:border-t-0">
            <Row label="Status">
              <StatusBadge status={goal.status} />
            </Row>
            <Row label="Priority">
              <PriorityBadge priority={goal.priority} />
            </Row>
            <Row label="Owner">{ownerName(goal.owner_id)}</Row>
            <Row label="Dates">
              {shortDate(goal.start_date)} → {shortDate(goal.end_date)}
            </Row>
            <Row label="Month / week">
              {goal.month ? `Month ${goal.month}` : "—"}
              {goal.week ? ` · Week ${goal.week}` : ""}
            </Row>
            <Row label="Budget">{goal.budget ? inr(goal.budget) : "—"}</Row>
            <Row label="Estimated effort">{hours > 0 ? `${hours} hours` : "—"}</Row>
            {goal.target_kpi && <Row label="Target KPI">{goal.target_kpi}</Row>}
            {goal.actual_kpi && <Row label="Actual KPI">{goal.actual_kpi}</Row>}
            <div className="border-t border-line pt-3 text-[11px] text-faint">
              Currently {STATUS_META[goal.status].label.toLowerCase()}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">{label}</p>
      <div className="text-xs text-fg">{children}</div>
    </div>
  );
}
