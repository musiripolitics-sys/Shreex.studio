"use client";

import { useMemo, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "@/components/Toast";
import { Modal, Field, Input, Textarea, Select, FormActions } from "@/components/os/Modal";
import { Card, PriorityBadge, EmptyState } from "@/components/os/ui";
import {
  BOS_STATUSES,
  BOS_PRIORITIES,
  BOS_FREQUENCIES,
  STATUS_META,
  freqLabel,
  inr,
  shortDate,
  rupeesToPaise,
  paiseToRupees,
  type BosStatus,
  type BosPriority,
  type BosFrequency,
} from "@/lib/bos";
import { saveTask, deleteTask, setTaskStatus } from "../actions";
import type { Task, TaskView } from "./types";
import type { Workstream, OwnerOption, Goal, RoadmapTask, TaskEdge } from "../roadmap/types";
import { TaskDetail, type TaskComment } from "../roadmap/TaskDetail";

const blank = {
  title: "",
  description: "",
  workstream_id: "",
  goal_id: "",
  owner_id: "",
  frequency: "one_time" as BosFrequency,
  start_date: "",
  due_date: "",
  status: "not_started" as BosStatus,
  priority: "medium" as BosPriority,
  budgetRupees: "",
  actualCostRupees: "",
  target: "",
  actual: "",
  estimateHours: "",
  actualHours: "",
  comments: "",
};

const todayISO = () => new Date().toISOString().slice(0, 10);

const VIEWS: { key: TaskView; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "overdue", label: "Overdue" },
  { key: "upcoming", label: "Upcoming" },
  { key: "blocked", label: "Blocked" },
  { key: "completed", label: "Completed" },
  { key: "all", label: "All" },
];

function matchesView(t: Task, view: TaskView): boolean {
  const today = todayISO();
  const open = t.status !== "completed" && t.status !== "cancelled";
  switch (view) {
    case "today":
      return t.due_date === today && open;
    case "week": {
      if (!t.due_date || !open) return false;
      const in7 = new Date();
      in7.setDate(in7.getDate() + 7);
      return t.due_date >= today && t.due_date <= in7.toISOString().slice(0, 10);
    }
    case "month": {
      if (!t.due_date || !open) return false;
      return t.due_date.slice(0, 7) === today.slice(0, 7);
    }
    case "overdue":
      return !!t.due_date && t.due_date < today && open;
    case "upcoming":
      return !!t.due_date && t.due_date >= today && open;
    case "blocked":
      return t.status === "blocked";
    case "completed":
      return t.status === "completed";
    default:
      return true;
  }
}

export function TasksClient({
  initialTasks,
  workstreams,
  goals,
  owners,
  allTasks,
  edges,
  comments,
  isAdmin,
  initialView,
}: {
  initialTasks: Task[];
  workstreams: Workstream[];
  goals: Goal[];
  owners: OwnerOption[];
  allTasks: RoadmapTask[];
  edges: TaskEdge[];
  comments: TaskComment[];
  isAdmin: boolean;
  initialView: TaskView;
}) {
  const [view, setView] = useState<TaskView>(initialView);
  const [open, setOpen] = useState(false);
  // A review links here as ?task=<id>; open it rather than leaving the reader
  // to find one row among forty-six.
  const params = useSearchParams();
  const [detailId, setDetailId] = useState<string | null>(() => params.get("task"));
  const [editing, setEditing] = useState<Task | null>(null);
  const [form, setForm] = useState({ ...blank });
  const [pending, start] = useTransition();

  const wsMap = useMemo(() => Object.fromEntries(workstreams.map((w) => [w.id, w])), [workstreams]);
  const ownerName = (id: string | null) =>
    owners.find((o) => o.id === id)?.full_name || (id ? "—" : "Unassigned");

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const v of VIEWS) c[v.key] = initialTasks.filter((t) => matchesView(t, v.key)).length;
    return c;
  }, [initialTasks]);

  const rows = initialTasks.filter((t) => matchesView(t, view));

  // allTasks first: it is the wider list, so a blocker outside this view — or
  // outside this employee's own work — still opens, and it is the one that
  // carries a sane approval_state on a database without 0020.
  const detailTask: RoadmapTask | null = detailId
    ? (allTasks.find((t) => t.id === detailId) ??
       initialTasks.find((t) => t.id === detailId) ??
       null)
    : null;

  const openNew = () => {
    setEditing(null);
    setForm({ ...blank });
    setOpen(true);
  };
  const openEdit = (t: Task) => {
    setEditing(t);
    setForm({
      title: t.title,
      description: t.description ?? "",
      workstream_id: t.workstream_id ?? "",
      goal_id: t.goal_id ?? "",
      owner_id: t.owner_id ?? "",
      frequency: t.frequency,
      start_date: t.start_date ?? "",
      due_date: t.due_date ?? "",
      status: t.status,
      priority: t.priority,
      budgetRupees: t.budget ? paiseToRupees(t.budget).toString() : "",
      actualCostRupees: t.actual_cost ? paiseToRupees(t.actual_cost).toString() : "",
      target: t.target?.toString() ?? "",
      actual: t.actual?.toString() ?? "",
      estimateHours: t.estimate_hours?.toString() ?? "",
      actualHours: t.actual_hours?.toString() ?? "",
      comments: t.comments ?? "",
    });
    setOpen(true);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      title: form.title,
      description: form.description || null,
      workstream_id: form.workstream_id || null,
      goal_id: form.goal_id || null,
      owner_id: form.owner_id || null,
      frequency: form.frequency,
      start_date: form.start_date || null,
      due_date: form.due_date || null,
      status: form.status,
      priority: form.priority,
      budget: form.budgetRupees ? rupeesToPaise(Number(form.budgetRupees)) : 0,
      actual_cost: form.actualCostRupees ? rupeesToPaise(Number(form.actualCostRupees)) : 0,
      target: form.target ? Number(form.target) : null,
      actual: form.actual ? Number(form.actual) : null,
      estimate_hours: form.estimateHours ? Number(form.estimateHours) : null,
      actual_hours: form.actualHours ? Number(form.actualHours) : null,
      comments: form.comments || null,
    };
    start(async () => {
      const res = await saveTask(editing?.id ?? null, payload);
      if (res?.error) toast(res.error, "error");
      else {
        toast(editing ? "Task updated" : "Task added", "success");
        setOpen(false);
      }
    });
  };

  const remove = (t: Task) => {
    if (!confirm(`Delete task "${t.title}"?`)) return;
    start(async () => {
      const res = await deleteTask(t.id);
      if (res?.error) toast(res.error, "error");
      else toast("Task deleted", "success");
    });
  };

  const quickStatus = (t: Task, status: BosStatus) => {
    start(async () => {
      const res = await setTaskStatus(t.id, status);
      if (res?.error) toast(res.error, "error");
    });
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg">Master Tasks</h1>
          <p className="text-sm text-muted">One centralized task system across every workstream.</p>
        </div>
        <button onClick={openNew} className="rounded-full bg-brand px-4 py-2 text-sm font-medium text-white">
          + Add task
        </button>
      </div>

      {/* View tabs */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              view === v.key ? "bg-brand text-white" : "border border-line bg-surface text-muted hover:text-fg"
            }`}
          >
            {v.label}
            <span className={`rounded-full px-1.5 text-[10px] ${view === v.key ? "bg-white/25" : "bg-ink-2"}`}>
              {counts[v.key] ?? 0}
            </span>
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState title="Nothing here" hint="No tasks match this view yet." />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[880px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-faint">
                <th className="px-4 py-3 font-semibold">Task</th>
                <th className="px-3 py-3 font-semibold">Workstream</th>
                <th className="px-3 py-3 font-semibold">Owner</th>
                <th className="px-3 py-3 font-semibold">Due</th>
                <th className="px-3 py-3 font-semibold">Freq</th>
                <th className="px-3 py-3 font-semibold">Priority</th>
                <th className="px-3 py-3 font-semibold">Status</th>
                <th className="px-3 py-3 text-right font-semibold">Budget / Actual</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const ws = t.workstream_id ? wsMap[t.workstream_id] : null;
                const overdue = t.due_date && t.due_date < todayISO() && t.status !== "completed" && t.status !== "cancelled";
                return (
                  <tr key={t.id} className="border-b border-line/60 last:border-0 hover:bg-surface-2">
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setDetailId(t.id)}
                        className="block text-left font-medium text-fg hover:text-brand hover:underline"
                      >
                        {t.title}
                      </button>
                      {t.description && <p className="text-xs text-muted">{t.description}</p>}
                    </td>
                    <td className="px-3 py-3">
                      {ws ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                          <span className="h-2 w-2 rounded-full" style={{ background: ws.color ?? "#999" }} />
                          {ws.name}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-3 text-muted">{ownerName(t.owner_id)}</td>
                    <td className={`px-3 py-3 text-xs ${overdue ? "font-semibold text-red-600" : "text-muted"}`}>
                      {shortDate(t.due_date)}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted">{freqLabel(t.frequency)}</td>
                    <td className="px-3 py-3"><PriorityBadge priority={t.priority} /></td>
                    <td className="px-3 py-3">
                      <select
                        value={t.status}
                        onChange={(e) => quickStatus(t, e.target.value as BosStatus)}
                        className="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-fg outline-none focus:border-brand"
                      >
                        {BOS_STATUSES.map((s) => (
                          <option key={s} value={s}>{STATUS_META[s].label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-3 text-right text-xs tabular-nums text-muted">
                      {t.budget ? inr(t.budget) : "—"}
                      {t.actual_cost ? ` / ${inr(t.actual_cost)}` : ""}
                    </td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      <button onClick={() => openEdit(t)} className="text-xs font-medium text-brand-soft hover:underline">Edit</button>
                      <button onClick={() => remove(t)} className="ml-3 text-xs font-medium text-red-600 hover:underline">Delete</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Edit task" : "Add task"} wide>
        <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Task *">
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Description">
              <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
          </div>
          <Field label="Workstream">
            <Select value={form.workstream_id} onChange={(e) => setForm({ ...form, workstream_id: e.target.value })}>
              <option value="">—</option>
              {workstreams.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </Field>
          <Field label="Linked goal">
            <Select value={form.goal_id} onChange={(e) => setForm({ ...form, goal_id: e.target.value })}>
              <option value="">—</option>
              {goals.map((g) => <option key={g.id} value={g.id}>{g.objective}</option>)}
            </Select>
          </Field>
          <Field label="Owner">
            <Select value={form.owner_id} onChange={(e) => setForm({ ...form, owner_id: e.target.value })}>
              <option value="">Unassigned</option>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.full_name || o.email}</option>)}
            </Select>
          </Field>
          <Field label="Frequency">
            <Select value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value as BosFrequency })}>
              {BOS_FREQUENCIES.map((f) => <option key={f} value={f}>{freqLabel(f)}</option>)}
            </Select>
          </Field>
          <Field label="Start date">
            <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
          </Field>
          <Field label="Due date">
            <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
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
          <Field label="Actual cost (₹)">
            <Input type="number" min={0} step="0.01" value={form.actualCostRupees} onChange={(e) => setForm({ ...form, actualCostRupees: e.target.value })} />
          </Field>
          <Field label="Target">
            <Input type="number" step="any" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} />
          </Field>
          <Field label="Actual">
            <Input type="number" step="any" value={form.actual} onChange={(e) => setForm({ ...form, actual: e.target.value })} />
          </Field>
          <Field label="Estimated hours">
            <Input type="number" min={0} step="0.5" value={form.estimateHours} onChange={(e) => setForm({ ...form, estimateHours: e.target.value })} />
          </Field>
          <Field label="Actual hours">
            <Input type="number" min={0} step="0.5" value={form.actualHours} onChange={(e) => setForm({ ...form, actualHours: e.target.value })} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Comments">
              <Textarea rows={2} value={form.comments} onChange={(e) => setForm({ ...form, comments: e.target.value })} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <FormActions onCancel={() => setOpen(false)} saving={pending} submitLabel={editing ? "Save changes" : "Add task"} />
          </div>
        </form>
      </Modal>

      {/* Keyed on the id so following a blocker remounts with a fresh draft. */}
      {detailTask && (
        <TaskDetail
          key={detailTask.id}
          task={detailTask}
          goal={goals.find((g) => g.id === detailTask.goal_id) ?? null}
          allTasks={allTasks}
          edges={edges}
          comments={comments.filter((c) => c.task_id === detailTask.id)}
          owners={owners}
          isAdmin={isAdmin}
          onClose={() => setDetailId(null)}
          onOpenTask={setDetailId}
        />
      )}
    </>
  );
}
