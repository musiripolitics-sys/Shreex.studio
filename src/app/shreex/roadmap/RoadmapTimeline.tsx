"use client";

import { useMemo, useRef, useState } from "react";
import { STATUS_META, shortDate, type BosStatus } from "@/lib/bos";
import type { Goal, RoadmapTask, TaskEdge, Workstream } from "./types";

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(s.slice(0, 10) + "T00:00:00Z");

/** Row heights are fixed so bar and arrow geometry is computable, not measured. */
const ROW_GOAL = 42;
const ROW_TASK = 28;
const LABELS_W = 264;

/** Zoom sets pixels per day; everything else derives from it. */
const ZOOM = {
  month: { px: 5, label: "Month", tick: "month" as const },
  week: { px: 16, label: "Week", tick: "week" as const },
  day: { px: 40, label: "Day", tick: "day" as const },
};
type Zoom = keyof typeof ZOOM;

const FILL: Record<BosStatus, string> = {
  completed: "#22c55e",
  in_progress: "#3b82f6",
  not_started: "#cbd5e1",
  blocked: "#ef4444",
  on_hold: "#f59e0b",
  cancelled: "#e2e8f0",
};

type Row =
  | { kind: "goal"; y: number; h: number; goal: Goal; tasks: RoadmapTask[]; open: boolean }
  | { kind: "task"; y: number; h: number; task: RoadmapTask };

/**
 * The plan as a timeline: goals as phases, their tasks nested beneath, and the
 * dependency graph drawn as connectors between bars.
 *
 * Laid out in pixels-per-day rather than percentages. That is what makes zoom
 * meaningful and lets the connectors be real geometry instead of guesses — an
 * arrow that lands a few pixels off is worse than no arrow.
 */
export function RoadmapTimeline({
  goals,
  tasks,
  edges,
  workstreams,
  ownerName,
  onOpenGoal,
  onOpenTask,
}: {
  goals: Goal[];
  tasks: RoadmapTask[];
  edges: TaskEdge[];
  workstreams: Workstream[];
  ownerName: (id: string | null) => string;
  onOpenGoal: (g: Goal) => void;
  onOpenTask: (id: string) => void;
}) {
  const [zoom, setZoom] = useState<Zoom>("week");
  const [open, setOpen] = useState<Set<string>>(() => new Set(goals.slice(0, 1).map((g) => g.id)));
  const [hover, setHover] = useState<{ x: number; y: number; body: string[] } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const wsMap = Object.fromEntries(workstreams.map((w) => [w.id, w]));
  const px = ZOOM[zoom].px;
  const today = iso(new Date());

  // ── Date span, padded so bars never touch the edge ──────────────────────
  const span = useMemo(() => {
    const all = [
      ...goals.flatMap((g) => [g.start_date, g.end_date]),
      ...tasks.flatMap((t) => [t.start_date, t.due_date]),
    ].filter(Boolean) as string[];
    if (!all.length) return null;
    const min = day(all.reduce((a, b) => (a < b ? a : b)));
    const max = day(all.reduce((a, b) => (a > b ? a : b)));
    min.setUTCDate(min.getUTCDate() - 2);
    max.setUTCDate(max.getUTCDate() + 2);
    return { min, max, days: Math.max(1, Math.round((+max - +min) / DAY)) };
  }, [goals, tasks]);

  // ── Rows, in render order, with their y offsets ─────────────────────────
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let y = 0;
    for (const g of goals) {
      const mine = tasks.filter((t) => t.goal_id === g.id);
      const isOpen = open.has(g.id);
      out.push({ kind: "goal", y, h: ROW_GOAL, goal: g, tasks: mine, open: isOpen });
      y += ROW_GOAL;
      if (isOpen) {
        for (const t of mine) {
          out.push({ kind: "task", y, h: ROW_TASK, task: t });
          y += ROW_TASK;
        }
      }
    }
    return out;
  }, [goals, tasks, open]);

  if (!span) {
    return (
      <p className="rounded-2xl border border-dashed border-line bg-surface-2 px-6 py-12 text-center text-sm text-muted">
        Nothing dated yet. Give goals a start and end date to see them here.
      </p>
    );
  }

  const chartW = span.days * px;
  const totalH = rows.reduce((a, r) => a + r.h, 0);
  const xOf = (d: string) => ((+day(d) - +span.min) / DAY) * px;
  const barOf = (from: string | null, to: string | null) => {
    const a = from ?? to;
    const b = to ?? from;
    if (!a || !b) return null;
    const x = xOf(a);
    return { x, w: Math.max(px * 0.8, xOf(b) - x + px) };
  };

  // ── Ticks ───────────────────────────────────────────────────────────────
  const ticks: { x: number; label: string; major: boolean }[] = [];
  {
    const c = new Date(span.min);
    c.setUTCHours(0, 0, 0, 0);
    while (c <= span.max) {
      const x = ((+c - +span.min) / DAY) * px;
      if (zoom === "day") {
        ticks.push({ x, label: String(c.getUTCDate()), major: c.getUTCDay() === 1 });
        c.setUTCDate(c.getUTCDate() + 1);
      } else if (zoom === "week") {
        if (c.getUTCDay() === 1)
          ticks.push({
            x,
            label: c.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }),
            major: c.getUTCDate() <= 7,
          });
        c.setUTCDate(c.getUTCDate() + 1);
      } else {
        if (c.getUTCDate() === 1)
          ticks.push({
            x,
            label: c.toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" }),
            major: true,
          });
        c.setUTCDate(c.getUTCDate() + 1);
      }
    }
  }

  // ── Month bands, so long spans stay readable when zoomed out ────────────
  const bands: { x: number; w: number }[] = [];
  {
    const c = new Date(Date.UTC(span.min.getUTCFullYear(), span.min.getUTCMonth(), 1));
    let i = 0;
    while (c <= span.max) {
      const next = new Date(c);
      next.setUTCMonth(next.getUTCMonth() + 1);
      if (i++ % 2 === 1) {
        const x = Math.max(0, ((+c - +span.min) / DAY) * px);
        const w = ((+(next < span.max ? next : span.max) - +c) / DAY) * px;
        if (w > 0) bands.push({ x, w });
      }
      c.setTime(+next);
    }
  }

  const todayX = ((+day(today) - +span.min) / DAY) * px;
  const todayVisible = todayX >= 0 && todayX <= chartW;

  // ── Dependency connectors between visible bars ──────────────────────────
  const visibleTaskY = new Map<string, number>();
  for (const r of rows) if (r.kind === "task") visibleTaskY.set(r.task.id, r.y);

  // A blocker inside a collapsed goal has nowhere for a line to land. Rather
  // than draw into empty space, the bar carries a marker saying how many
  // blockers are hidden, so the dependency is never silently invisible.
  const hiddenBlockers = new Map<string, number>();
  for (const e of edges) {
    if (!e.from_id || !e.to_id) continue;
    if (visibleTaskY.has(e.from_id) && !visibleTaskY.has(e.to_id)) {
      hiddenBlockers.set(e.from_id, (hiddenBlockers.get(e.from_id) ?? 0) + 1);
    }
  }

  const connectors = edges
    .map((e) => {
      if (!e.from_id || !e.to_id) return null;
      const fy = visibleTaskY.get(e.from_id);
      const ty = visibleTaskY.get(e.to_id);
      if (fy == null || ty == null) return null;
      const from = tasks.find((t) => t.id === e.from_id);
      const to = tasks.find((t) => t.id === e.to_id);
      const fb = from && barOf(from.start_date, from.due_date);
      const tb = to && barOf(to.start_date, to.due_date);
      if (!fb || !tb || !from || !to) return null;
      // Blocker's end → dependent's start.
      const x1 = tb.x + tb.w;
      const y1 = ty + ROW_TASK / 2;
      const x2 = fb.x;
      const y2 = fy + ROW_TASK / 2;
      const met = to.status === "completed";
      const gap = Math.max(8, px * 0.5);
      const mx = x2 - gap < x1 + gap ? x1 + gap : x2 - gap;
      return {
        id: e.id,
        d: `M ${x1} ${y1} H ${mx} V ${y2} H ${x2}`,
        met,
        critical: from.dependency_id === to.id,
      };
    })
    .filter(Boolean) as { id: string; d: string; met: boolean; critical: boolean }[];

  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const jumpToToday = () => {
    const el = scroller.current;
    if (el) el.scrollTo({ left: Math.max(0, todayX - el.clientWidth / 2), behavior: "smooth" });
  };

  const late = (end: string | null, status: BosStatus) =>
    !!end && end.slice(0, 10) < today && status !== "completed" && status !== "cancelled";

  return (
    <div className="rounded-2xl border border-line bg-surface">
      {/* ── Controls ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex rounded-full border border-line p-0.5">
            {(Object.keys(ZOOM) as Zoom[]).map((z) => (
              <button
                key={z}
                onClick={() => setZoom(z)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  zoom === z ? "bg-brand text-white" : "text-muted hover:text-fg"
                }`}
              >
                {ZOOM[z].label}
              </button>
            ))}
          </div>
          <button
            onClick={jumpToToday}
            className="rounded-full border border-line px-2.5 py-1 text-[11px] font-medium text-muted transition-colors hover:border-brand hover:text-brand"
          >
            Today
          </button>
          <button
            onClick={() => setOpen(open.size ? new Set() : new Set(goals.map((g) => g.id)))}
            className="rounded-full border border-line px-2.5 py-1 text-[11px] font-medium text-muted transition-colors hover:border-brand hover:text-brand"
          >
            {open.size ? "Collapse all" : "Expand all"}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-[10px] text-faint">
          {(["completed", "in_progress", "not_started", "blocked", "on_hold"] as BosStatus[]).map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ background: FILL[s] }} />
              {STATUS_META[s].label}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <svg width="16" height="6" aria-hidden>
              <path d="M0 3 H16" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="3 2" />
            </svg>
            depends on
          </span>
        </div>
      </div>

      {/* ── Chart ── */}
      <div ref={scroller} className="relative overflow-x-auto">
        <div style={{ width: LABELS_W + chartW, minWidth: "100%" }}>
          {/* Axis */}
          <div className="sticky top-0 z-30 flex h-9 border-b border-line bg-surface-2">
            <div
              className="sticky left-0 z-10 flex shrink-0 items-center border-r border-line bg-surface-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-faint"
              style={{ width: LABELS_W }}
            >
              {goals.length} goals · {tasks.length} tasks
            </div>
            <div className="relative" style={{ width: chartW }}>
              {ticks.map((t, i) => (
                <span
                  key={i}
                  className={`absolute top-2.5 whitespace-nowrap text-[10px] ${
                    t.major ? "font-semibold text-muted" : "text-faint"
                  }`}
                  style={{ left: t.x + 3 }}
                >
                  {t.label}
                </span>
              ))}
            </div>
          </div>

          <div className="relative flex">
            {/* Labels */}
            <div
              className="sticky left-0 z-20 shrink-0 border-r border-line bg-surface"
              style={{ width: LABELS_W, height: totalH }}
            >
              {rows.map((r) =>
                r.kind === "goal" ? (
                  <button
                    key={r.goal.id}
                    onClick={() => r.tasks.length > 0 && toggle(r.goal.id)}
                    className="absolute flex w-full items-center gap-2 border-b border-line/60 px-3 text-left hover:bg-surface-2"
                    style={{ top: r.y, height: r.h }}
                  >
                    <span className={`w-2.5 text-[9px] text-faint ${r.tasks.length ? "" : "opacity-0"}`}>
                      {r.open ? "▾" : "▸"}
                    </span>
                    {r.goal.workstream_id && wsMap[r.goal.workstream_id] && (
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: wsMap[r.goal.workstream_id]!.color ?? "#999" }}
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-fg">
                        {r.goal.code ?? ""} {r.goal.objective}
                      </span>
                      <span className="block text-[10px] text-faint">
                        {r.tasks.length
                          ? `${r.tasks.filter((t) => t.status === "completed").length}/${r.tasks.length} done`
                          : "no tasks"}
                      </span>
                    </span>
                  </button>
                ) : (
                  <div
                    key={r.task.id}
                    className="absolute flex w-full items-center gap-2 pl-8 pr-3"
                    style={{ top: r.y, height: r.h }}
                  >
                    <span className="font-mono text-[10px] text-faint">{r.task.code}</span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-muted">{r.task.title}</span>
                    {late(r.task.due_date, r.task.status) && (
                      <span className="shrink-0 rounded bg-red-100 px-1 text-[9px] font-semibold text-red-700">
                        late
                      </span>
                    )}
                  </div>
                ),
              )}
            </div>

            {/* Bars */}
            <div className="relative" style={{ width: chartW, height: totalH }}>
              {bands.map((b, i) => (
                <div key={i} className="absolute inset-y-0 bg-ink/40" style={{ left: b.x, width: b.w }} />
              ))}
              {ticks
                .filter((t) => t.major)
                .map((t, i) => (
                  <div key={i} className="absolute inset-y-0 w-px bg-line/70" style={{ left: t.x }} />
                ))}
              {rows.map((r) => (
                <div
                  key={`sep-${r.kind === "goal" ? r.goal.id : r.task.id}`}
                  className={`absolute left-0 right-0 ${r.kind === "goal" ? "border-b border-line/60" : ""}`}
                  style={{ top: r.y, height: r.h }}
                />
              ))}

              {/* Connectors sit under the bars so they never obscure a label */}
              <svg className="absolute inset-0 z-10" width={chartW} height={totalH} aria-hidden>
                {connectors.map((c) => (
                  <path
                    key={c.id}
                    d={c.d}
                    fill="none"
                    stroke={c.met ? "#86efac" : c.critical ? "#f59e0b" : "#94a3b8"}
                    strokeWidth={c.critical ? 1.6 : 1.2}
                    strokeDasharray={c.met ? "0" : "3 2"}
                  />
                ))}
              </svg>

              {rows.map((r) => {
                if (r.kind === "goal") {
                  const b = barOf(r.goal.start_date, r.goal.end_date);
                  if (!b) return null;
                  const done = r.tasks.filter((t) => t.status === "completed").length;
                  const pct = r.tasks.length ? (done / r.tasks.length) * 100 : 0;
                  const isLate = late(r.goal.end_date, r.goal.status);
                  return (
                    <button
                      key={r.goal.id}
                      onClick={() => onOpenGoal(r.goal)}
                      onMouseEnter={(e) =>
                        setHover({
                          x: e.clientX,
                          y: e.clientY,
                          body: [
                            `${r.goal.code ?? ""} ${r.goal.objective}`,
                            `${shortDate(r.goal.start_date)} → ${shortDate(r.goal.end_date)}`,
                            `${done} of ${r.tasks.length} tasks done · ${STATUS_META[r.goal.status].label}`,
                            ownerName(r.goal.owner_id),
                          ],
                        })
                      }
                      onMouseLeave={() => setHover(null)}
                      className="absolute z-20 overflow-hidden rounded-md shadow-sm"
                      style={{
                        left: b.x,
                        width: b.w,
                        top: r.y + 11,
                        height: 20,
                        background: "#e2e8f0",
                        outline: isLate ? "2px solid #ef4444" : undefined,
                      }}
                    >
                      <span
                        className="absolute inset-y-0 left-0"
                        style={{ width: `${pct}%`, background: FILL[r.goal.status] }}
                      />
                      {b.w > 64 && (
                        <span className="absolute inset-y-0 left-2 flex items-center text-[10px] font-semibold text-slate-700">
                          {Math.round(pct)}%
                        </span>
                      )}
                    </button>
                  );
                }
                const b = barOf(r.task.start_date, r.task.due_date);
                if (!b) return null;
                const isLate = late(r.task.due_date, r.task.status);
                const hidden = hiddenBlockers.get(r.task.id) ?? 0;
                return (
                  <button
                    key={r.task.id}
                    onClick={() => onOpenTask(r.task.id)}
                    onMouseEnter={(e) =>
                      setHover({
                        x: e.clientX,
                        y: e.clientY,
                        body: [
                          `${r.task.code ?? ""} ${r.task.title}`,
                          `${shortDate(r.task.start_date)} → ${shortDate(r.task.due_date)}`,
                          [
                            STATUS_META[r.task.status].label,
                            r.task.estimate_hours != null ? `${r.task.estimate_hours}h estimated` : null,
                          ]
                            .filter(Boolean)
                            .join(" · "),
                          ownerName(r.task.owner_id),
                          hidden > 0
                            ? `${hidden} blocker${hidden === 1 ? "" : "s"} in a collapsed goal`
                            : null,
                        ].filter(Boolean) as string[],
                      })
                    }
                    onMouseLeave={() => setHover(null)}
                    className="absolute z-20 rounded transition-opacity hover:opacity-80"
                    style={{
                      left: b.x,
                      width: b.w,
                      top: r.y + 10,
                      height: 9,
                      background: FILL[r.task.status],
                      outline: isLate ? "2px solid #ef4444" : undefined,
                    }}
                  >
                    {hidden > 0 && (
                      <span
                        className="absolute -left-1.5 top-1/2 grid h-3 w-3 -translate-x-full -translate-y-1/2 place-items-center rounded-full bg-amber-500 text-[7px] font-bold leading-none text-white"
                        title={`${hidden} blocker${hidden === 1 ? "" : "s"} hidden in a collapsed goal`}
                      >
                        {hidden}
                      </span>
                    )}
                  </button>
                );
              })}

              {/* Today */}
              {todayVisible && (
                <div className="pointer-events-none absolute inset-y-0 z-30 w-px bg-brand" style={{ left: todayX }}>
                  <span className="absolute -top-0 -translate-x-1/2 rounded-b bg-brand px-1 text-[9px] font-semibold text-white">
                    today
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Detail on hover, rather than crowding every bar with text */}
      {hover && (
        <div
          className="pointer-events-none fixed z-50 max-w-xs rounded-lg border border-line bg-surface px-3 py-2 shadow-lg"
          style={{ left: Math.min(hover.x + 14, 1100), top: hover.y + 14 }}
        >
          <p className="text-xs font-semibold text-fg">{hover.body[0]}</p>
          {hover.body.slice(1).map((l, i) => (
            <p key={i} className="text-[11px] text-muted">
              {l}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
