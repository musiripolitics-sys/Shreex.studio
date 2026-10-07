"use client";

import { useOptimistic, useState, useTransition } from "react";
import { toast } from "@/components/Toast";
import { PriorityBadge } from "@/components/os/ui";
import { shortDate, type BosStatus } from "@/lib/bos";
import { setMyTaskStatus, submitTaskForApproval } from "./actions";
import type { MyTask } from "./EmployeeDashboard";

/** The stages an employee actually moves work through. */
const COLUMNS: { key: BosStatus; label: string; accent: string; hint: string }[] = [
  { key: "not_started", label: "Open", accent: "bg-slate-400", hint: "Not started yet" },
  { key: "in_progress", label: "Working", accent: "bg-blue-500", hint: "In progress" },
  { key: "blocked", label: "Blocked", accent: "bg-red-500", hint: "Waiting on something" },
  { key: "completed", label: "Completed", accent: "bg-green-500", hint: "Done" },
];

const DAY = 86_400_000;
const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

function countdown(date: string | null) {
  if (!date) return null;
  const days = Math.round((midnight(new Date(date.slice(0, 10))) - midnight(new Date())) / DAY);
  if (days < 0) return { text: `${-days}d late`, cls: "bg-red-100 text-red-700" };
  if (days === 0) return { text: "today", cls: "bg-amber-100 text-amber-700" };
  if (days === 1) return { text: "tomorrow", cls: "bg-amber-50 text-amber-700" };
  if (days <= 7) return { text: `${days}d left`, cls: "bg-blue-50 text-blue-700" };
  return { text: `${Math.round(days / 7)}w left`, cls: "bg-surface-2 text-muted" };
}

/**
 * The employee's own board.
 *
 * Cards are dragged between stages, and the move is applied optimistically so
 * the card lands where it was dropped rather than snapping back while the
 * write travels. On-hold sits in Blocked because from the board's point of
 * view they are the same thing: not moving. Cancelled is hidden.
 */
export function MyKanban({
  tasks,
  blockedTitles,
}: {
  tasks: MyTask[];
  blockedTitles: Record<string, string>;
}) {
  const [saving, start] = useTransition();
  const [dragOver, setDragOver] = useState<BosStatus | null>(null);
  const [moved, setMoved] = useOptimistic(
    tasks,
    (state: MyTask[], patch: { id: string; status: BosStatus }) =>
      state.map((t) => (t.id === patch.id ? { ...t, status: patch.status } : t)),
  );

  const columnOf = (t: MyTask): BosStatus | null => {
    if (t.status === "cancelled") return null;
    if (t.status === "on_hold") return "blocked";
    return t.status;
  };

  const move = (id: string, status: BosStatus) => {
    const task = moved.find((t) => t.id === id);
    if (!task || columnOf(task) === status) return;

    // Finishing your own work is not your call. Dropping a card in Completed
    // asks an admin to approve it; the card stays where it is until they do.
    if (status === "completed") {
      if (task.approval_state === "pending") {
        toast("Already waiting on an admin to approve this.", "error");
        return;
      }
      start(async () => {
        const res = await submitTaskForApproval(id);
        if ("error" in res && res.error) toast(res.error, "error");
        else toast("Sent for approval", "success");
      });
      return;
    }

    start(async () => {
      setMoved({ id, status });
      const res = await setMyTaskStatus(id, status);
      if ("error" in res && res.error) toast(res.error, "error");
    });
  };

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {COLUMNS.map((col) => {
        const rows = moved.filter((t) => columnOf(t) === col.key);
        const active = dragOver === col.key;
        return (
          <div
            key={col.key}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(col.key);
            }}
            onDragLeave={() => setDragOver((c) => (c === col.key ? null : c))}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(null);
              const id = e.dataTransfer.getData("text/plain");
              if (id) move(id, col.key);
            }}
            className={`flex min-h-[9rem] flex-col rounded-2xl border p-2.5 transition-colors ${
              active ? "border-brand bg-brand/5" : "border-line bg-surface-2/40"
            }`}
          >
            <div className="mb-2 flex items-center gap-2 px-1">
              <span className={`h-2 w-2 rounded-full ${col.accent}`} />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-fg">
                {col.label}
              </span>
              <span className="ml-auto text-[11px] tabular-nums text-faint">{rows.length}</span>
            </div>

            <div className="flex flex-1 flex-col gap-2">
              {rows.length === 0 ? (
                <p className="px-1 py-6 text-center text-[11px] text-faint">
                  {active ? "Drop here" : col.hint}
                </p>
              ) : (
                rows.map((t) => {
                  const c = countdown(t.due_date);
                  const waiting = blockedTitles[t.id];
                  const done = t.status === "completed";
                  const waitingApproval = t.approval_state === "pending";
                  return (
                    <div
                      key={t.id}
                      draggable={!saving}
                      onDragStart={(e) => e.dataTransfer.setData("text/plain", t.id)}
                      className={`cursor-grab rounded-xl border border-line bg-surface p-2.5 shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing ${
                        done ? "opacity-70" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-mono text-[10px] text-faint">{t.code}</span>
                        {waitingApproval && (
                          <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                            Awaiting approval
                          </span>
                        )}
                        {c && !done && !waitingApproval && (
                          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${c.cls}`}>
                            {c.text}
                          </span>
                        )}
                      </div>
                      <p className={`mt-1 line-clamp-3 text-sm leading-snug ${done ? "text-muted line-through" : "text-fg"}`}>
                        {t.title}
                      </p>
                      <div className="mt-2 flex items-center gap-1.5">
                        <PriorityBadge priority={t.priority} />
                        {t.estimate_hours != null && (
                          <span className="text-[10px] tabular-nums text-faint">{t.estimate_hours}h</span>
                        )}
                        <span className="ml-auto text-[10px] text-faint">{shortDate(t.due_date)}</span>
                      </div>
                      {waiting && (
                        <p className="mt-1.5 flex items-start gap-1 text-[10px] text-amber-700">
                          <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-amber-500" />
                          {waiting}
                        </p>
                      )}

                      {/* Dragging is the fast path; this is the one that works
                          on a phone and with a keyboard. */}
                      <select
                        value={col.key}
                        disabled={saving}
                        onChange={(e) => move(t.id, e.target.value as BosStatus)}
                        aria-label={`Move ${t.title}`}
                        className="mt-2 w-full rounded-lg border border-line bg-surface px-1.5 py-1 text-[11px] text-muted outline-none focus:border-brand disabled:opacity-50"
                      >
                        {COLUMNS.map((c2) => (
                          <option key={c2.key} value={c2.key}>
                            {c2.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
