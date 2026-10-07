"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "@/components/Toast";
import { Modal, Field, Input, Textarea, Select, FormActions } from "@/components/os/Modal";
import { Card, StatusBadge, PriorityBadge, EmptyState, SectionHeading } from "@/components/os/ui";
import {
  BOS_STATUSES,
  BOS_PRIORITIES,
  STATUS_META,
  inr,
  shortDate,
  rupeesToPaise,
  paiseToRupees,
  type BosStatus,
  type BosPriority,
} from "@/lib/bos";
import { saveGoal, deleteGoal, syncRoadmapTasks } from "../actions";
import type { Goal, Workstream, OwnerOption, RoadmapTask, TaskEdge } from "./types";
import { GoalTasks } from "./GoalTasks";
import { RoadmapTimeline } from "./RoadmapTimeline";
import { TaskDetail, type TaskComment } from "./TaskDetail";
import { GoalDetail } from "./GoalDetail";

type View = "month" | "week" | "list" | "timeline";

const blank = {
  objective: "",
  deliverable: "",
  workstream_id: "",
  owner_id: "",
  month: "",
  week: "",
  start_date: "",
  end_date: "",
  priority: "medium" as BosPriority,
  status: "not_started" as BosStatus,
  budgetRupees: "",
  target_kpi: "",
  actual_kpi: "",
  notes: "",
};

export function RoadmapClient({
  initialGoals,
  workstreams,
  owners,
  tasks,
  edges,
  comments,
  isAdmin,
}: {
  initialGoals: Goal[];
  workstreams: Workstream[];
  owners: OwnerOption[];
  tasks: RoadmapTask[];
  edges: TaskEdge[];
  comments: TaskComment[];
  isAdmin: boolean;
}) {
  const [view, setView] = useState<View>("month");
  const [syncing, setSyncing] = useState(false);
  // Which goals are expanded to show their tasks. Everything is already loaded,
  // so this is presentation only.
  const [openGoals, setOpenGoals] = useState<Set<string>>(new Set());
  // The task open in the detail panel, by id. Clicking a blocker inside the
  // panel swaps it, so navigation stays in one place.
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const openTask = openTaskId ? (tasks.find((t) => t.id === openTaskId) ?? null) : null;
  // A task panel elsewhere links here as ?goal=<id>; open that goal on arrival
  // rather than dropping the reader at the top of a ten-goal list.
  const params = useSearchParams();
  const [openGoalId, setOpenGoalId] = useState<string | null>(() => params.get("goal"));
  const openGoal = openGoalId ? (initialGoals.find((g) => g.id === openGoalId) ?? null) : null;
  const toggleGoal = (id: string) =>
    setOpenGoals((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [fWork, setFWork] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fPriority, setFPriority] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);
  const [form, setForm] = useState({ ...blank });
  const [pending, start] = useTransition();

  const wsMap = useMemo(
    () => Object.fromEntries(workstreams.map((w) => [w.id, w])),
    [workstreams],
  );
  const ownerName = (id: string | null) =>
    owners.find((o) => o.id === id)?.full_name || (id ? "—" : "Unassigned");

  const filtered = initialGoals.filter(
    (g) =>
      (!fWork || g.workstream_id === fWork) &&
      (!fStatus || g.status === fStatus) &&
      (!fPriority || g.priority === fPriority),
  );

  const openNew = () => {
    setEditing(null);
    setForm({ ...blank });
    setOpen(true);
  };
  const openEdit = (g: Goal) => {
    setEditing(g);
    setForm({
      objective: g.objective ?? "",
      deliverable: g.deliverable ?? "",
      workstream_id: g.workstream_id ?? "",
      owner_id: g.owner_id ?? "",
      month: g.month?.toString() ?? "",
      week: g.week?.toString() ?? "",
      start_date: g.start_date ?? "",
      end_date: g.end_date ?? "",
      priority: g.priority,
      status: g.status,
      budgetRupees: g.budget ? paiseToRupees(g.budget).toString() : "",
      target_kpi: g.target_kpi ?? "",
      actual_kpi: g.actual_kpi ?? "",
      notes: g.notes ?? "",
    });
    setOpen(true);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      objective: form.objective,
      deliverable: form.deliverable || null,
      workstream_id: form.workstream_id || null,
      owner_id: form.owner_id || null,
      month: form.month ? Number(form.month) : null,
      week: form.week ? Number(form.week) : null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      priority: form.priority,
      status: form.status,
      budget: form.budgetRupees ? rupeesToPaise(Number(form.budgetRupees)) : 0,
      target_kpi: form.target_kpi || null,
      actual_kpi: form.actual_kpi || null,
      notes: form.notes || null,
    };
    start(async () => {
      const res = await saveGoal(editing?.id ?? null, payload);
      if (res?.error) toast(res.error, "error");
      else {
        toast(editing ? "Goal updated" : "Goal added", "success");
        setOpen(false);
      }
    });
  };

  const remove = (g: Goal) => {
    if (!confirm(`Delete goal "${g.objective}"? This cannot be undone.`)) return;
    start(async () => {
      const res = await deleteGoal(g.id);
      if (res?.error) toast(res.error, "error");
      else toast("Goal deleted", "success");
    });
  };

  // Grouping
  const groups: { key: string; label: string; rows: Goal[] }[] = useMemo(() => {
    if (view === "list") return [{ key: "all", label: "All goals", rows: filtered }];
    if (view === "week") {
      const byWeek = new Map<string, Goal[]>();
      for (const g of filtered) {
        const k = g.week ? `Week ${g.week}` : "Unscheduled";
        (byWeek.get(k) ?? byWeek.set(k, []).get(k)!).push(g);
      }
      return [...byWeek.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
        .map(([label, rows]) => ({ key: label, label, rows }));
    }
    // month
    const byMonth = new Map<string, Goal[]>();
    for (const g of filtered) {
      const k = g.month ? `Month ${g.month}` : "Unscheduled";
      (byMonth.get(k) ?? byMonth.set(k, []).get(k)!).push(g);
    }
    return [...byMonth.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
      .map(([label, rows]) => ({ key: label, label, rows }));
  }, [filtered, view]);

  const selectCls =
    "rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-fg outline-none focus:border-brand";

  // Each roadmap line becomes a task, so its dates show up as work on the
  // calendar instead of living only on this page.
  const onSyncTasks = () => {
    setSyncing(true);
    void syncRoadmapTasks()
      .then((res) => {
        if ("error" in res && res.error) {
          toast(res.error, "error");
          return;
        }
        const created = ("created" in res ? res.created : 0) ?? 0;
        toast(
          created > 0
            ? `Created ${created} task${created === 1 ? "" : "s"} from the roadmap`
            : "Every goal already has a task",
          "success",
        );
      })
      .finally(() => setSyncing(false));
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg">
            90-Day Roadmap
          </h1>
          <p className="text-sm text-muted">
            Strategy broken into month → week → owner → KPI.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onSyncTasks}
            disabled={syncing}
            className="rounded-full border border-line px-4 py-2 text-sm font-medium text-muted transition-colors hover:border-brand hover:text-brand disabled:opacity-50"
            title="Create a task for every goal that doesn't have one yet"
          >
            {syncing ? "Creating…" : "Create tasks from goals"}
          </button>
          <button
            onClick={openNew}
            className="rounded-full bg-brand px-4 py-2 text-sm font-medium text-white"
          >
            + Add goal
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-full border border-line bg-surface p-0.5">
          {(["month", "week", "list", "timeline"] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
                view === v ? "bg-brand text-white" : "text-muted hover:text-fg"
              }`}
            >
              {v === "month"
                ? "By month"
                : v === "week"
                  ? "By week"
                  : v === "list"
                    ? "All goals"
                    : "Timeline"}
            </button>
          ))}
        </div>
        <select value={fWork} onChange={(e) => setFWork(e.target.value)} className={selectCls}>
          <option value="">All workstreams</option>
          {workstreams.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={selectCls}>
          <option value="">All statuses</option>
          {BOS_STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_META[s].label}</option>
          ))}
        </select>
        <select value={fPriority} onChange={(e) => setFPriority(e.target.value)} className={selectCls}>
          <option value="">All priorities</option>
          {BOS_PRIORITIES.map((p) => (
            <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No goals match"
          hint="Add a 90-day goal, or clear the filters above."
        />
      ) : view === "timeline" ? (
        <RoadmapTimeline
          goals={filtered}
          tasks={tasks}
          edges={edges}
          workstreams={workstreams}
          ownerName={ownerName}
          onOpenGoal={(g) => setOpenGoalId(g.id)}
          onOpenTask={setOpenTaskId}
        />
      ) : (
        <div className="space-y-6">
          {groups.map((grp) => (
            <div key={grp.key}>
              <SectionHeading title={grp.label} desc={`${grp.rows.length} goal${grp.rows.length === 1 ? "" : "s"}`} />
              <Card className="overflow-x-auto p-0">
                <table className="w-full min-w-[860px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-faint">
                      <th className="px-4 py-3 font-semibold">Objective</th>
                      <th className="px-3 py-3 font-semibold">Workstream</th>
                      <th className="px-3 py-3 font-semibold">Owner</th>
                      <th className="px-3 py-3 font-semibold">Dates</th>
                      <th className="px-3 py-3 font-semibold">Priority</th>
                      <th className="px-3 py-3 font-semibold">Status</th>
                      <th className="px-3 py-3 text-right font-semibold">Budget</th>
                      <th className="px-3 py-3 font-semibold">KPI (t/a)</th>
                      <th className="px-3 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {grp.rows.map((g) => {
                      const ws = g.workstream_id ? wsMap[g.workstream_id] : null;
                      const goalTasks = tasks.filter((t) => t.goal_id === g.id);
                      const openTasks = goalTasks.filter(
                        (t) => t.status !== "completed" && t.status !== "cancelled",
                      ).length;
                      const isOpen = openGoals.has(g.id);
                      return (
                      <Fragment key={g.id}>
                        <tr className="border-b border-line/60 last:border-0 hover:bg-surface-2">
                          <td className="px-4 py-3">
                            <div className="flex items-start gap-2">
                              {goalTasks.length > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => toggleGoal(g.id)}
                                  aria-label={isOpen ? "Hide tasks" : "Show tasks"}
                                  aria-expanded={isOpen}
                                  className="mt-0.5 w-3 shrink-0 text-[10px] text-faint hover:text-fg"
                                >
                                  {isOpen ? "▾" : "▸"}
                                </button>
                              ) : (
                                <span className="mt-0.5 w-3 shrink-0" />
                              )}
                              <button
                                type="button"
                                onClick={() => setOpenGoalId(g.id)}
                                className="text-left"
                              >
                                <span className="block font-medium text-fg hover:text-brand hover:underline">{g.objective}</span>
                                {g.deliverable && (
                                  <span className="block text-xs text-muted">{g.deliverable}</span>
                                )}
                                {goalTasks.length > 0 && (
                                  <span className="mt-1 inline-block text-[11px] text-brand-soft">
                                    {goalTasks.length} task{goalTasks.length === 1 ? "" : "s"}
                                    {openTasks > 0 ? ` · ${openTasks} open` : " · all done"}
                                  </span>
                                )}
                              </button>
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            {ws ? (
                              <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                                <span className="h-2 w-2 rounded-full" style={{ background: ws.color ?? "#999" }} />
                                {ws.name}
                              </span>
                            ) : "—"}
                          </td>
                          <td className="px-3 py-3 text-muted">{ownerName(g.owner_id)}</td>
                          <td className="px-3 py-3 text-xs text-muted">
                            {shortDate(g.start_date)} → {shortDate(g.end_date)}
                          </td>
                          <td className="px-3 py-3"><PriorityBadge priority={g.priority} /></td>
                          <td className="px-3 py-3"><StatusBadge status={g.status} /></td>
                          <td className="px-3 py-3 text-right tabular-nums text-muted">
                            {g.budget ? inr(g.budget) : "—"}
                          </td>
                          <td className="px-3 py-3 text-xs text-muted">
                            {g.target_kpi || "—"}
                            {g.actual_kpi ? ` / ${g.actual_kpi}` : ""}
                          </td>
                          <td className="px-3 py-3 text-right whitespace-nowrap">
                            <button onClick={() => openEdit(g)} className="text-xs font-medium text-brand-soft hover:underline">
                              Edit
                            </button>
                            <button onClick={() => remove(g)} className="ml-3 text-xs font-medium text-red-600 hover:underline">
                              Delete
                            </button>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td colSpan={9} className="p-0">
                              <GoalTasks
                                tasks={goalTasks}
                                edges={edges}
                                allTasks={tasks}
                                ownerName={ownerName}
                                onOpenTask={setOpenTaskId}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Edit goal" : "Add goal"} wide>
        <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Objective *">
              <Input value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })} required />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Deliverable">
              <Input value={form.deliverable} onChange={(e) => setForm({ ...form, deliverable: e.target.value })} />
            </Field>
          </div>
          <Field label="Workstream">
            <Select value={form.workstream_id} onChange={(e) => setForm({ ...form, workstream_id: e.target.value })}>
              <option value="">—</option>
              {workstreams.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </Field>
          <Field label="Owner">
            <Select value={form.owner_id} onChange={(e) => setForm({ ...form, owner_id: e.target.value })}>
              <option value="">Unassigned</option>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.full_name || o.email}</option>)}
            </Select>
          </Field>
          <Field label="Month (1–3)">
            <Input type="number" min={1} max={3} value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })} />
          </Field>
          <Field label="Week (1–13)">
            <Input type="number" min={1} max={13} value={form.week} onChange={(e) => setForm({ ...form, week: e.target.value })} />
          </Field>
          <Field label="Start date">
            <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
          </Field>
          <Field label="End date">
            <Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
          </Field>
          <Field label="Priority">
            <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as BosPriority })}>
              {BOS_PRIORITIES.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as BosStatus })}>
              {BOS_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </Select>
          </Field>
          <Field label="Budget (₹)">
            <Input type="number" min={0} step="0.01" value={form.budgetRupees} onChange={(e) => setForm({ ...form, budgetRupees: e.target.value })} />
          </Field>
          <Field label="Target KPI">
            <Input value={form.target_kpi} onChange={(e) => setForm({ ...form, target_kpi: e.target.value })} placeholder="e.g. 500 or 500000" />
          </Field>
          <Field label="Actual KPI">
            <Input value={form.actual_kpi} onChange={(e) => setForm({ ...form, actual_kpi: e.target.value })} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Notes">
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <FormActions onCancel={() => setOpen(false)} saving={pending} submitLabel={editing ? "Save changes" : "Add goal"} />
          </div>
        </form>
      </Modal>

      {openGoal && !openTask && (
        <GoalDetail
          goal={openGoal}
          tasks={tasks.filter((t) => t.goal_id === openGoal.id)}
          edges={edges}
          owners={owners}
          workstreams={workstreams}
          onClose={() => setOpenGoalId(null)}
          onOpenTask={setOpenTaskId}
          onEdit={(g) => {
            setOpenGoalId(null);
            openEdit(g);
          }}
        />
      )}

      {/* Keyed on the task id so following a blocker remounts with a fresh draft. */}
      {openTask && (
        <TaskDetail
          key={openTask.id}
          task={openTask}
          goal={initialGoals.find((g) => g.id === openTask.goal_id) ?? null}
          allTasks={tasks}
          edges={edges}
          comments={comments.filter((c) => c.task_id === openTask.id)}
          owners={owners}
          isAdmin={isAdmin}
          onClose={() => setOpenTaskId(null)}
          onOpenTask={setOpenTaskId}
        />
      )}
    </>
  );
}
