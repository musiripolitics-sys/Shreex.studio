"use client";

import { useState } from "react";
import { StatusBadge, PriorityBadge } from "@/components/os/ui";
import { shortDate } from "@/lib/bos";
import type { RoadmapTask, TaskEdge } from "./types";

/**
 * The tasks belonging to one roadmap goal, each expandable to show what it
 * waits on. Three levels, one page: goal → task → dependency. Everything is
 * already loaded, so expanding never fetches.
 */
export function GoalTasks({
  tasks,
  edges,
  allTasks,
  ownerName,
  onOpenTask,
}: {
  tasks: RoadmapTask[];
  edges: TaskEdge[];
  allTasks: RoadmapTask[];
  ownerName: (id: string | null) => string;
  onOpenTask: (id: string) => void;
}) {
  if (tasks.length === 0) {
    return (
      <p className="px-4 py-3 text-xs text-faint">
        No tasks yet. Use <span className="font-medium">Create tasks from goals</span> to
        turn this goal into work.
      </p>
    );
  }

  return (
    <div className="divide-y divide-line/60 border-t border-line/60 bg-surface-2/40">
      {tasks.map((t) => (
        <TaskRow
          key={t.id}
          task={t}
          edges={edges.filter((e) => e.from_id === t.id)}
          allTasks={allTasks}
          ownerName={ownerName}
          onOpenTask={onOpenTask}
        />
      ))}
    </div>
  );
}

function TaskRow({
  task,
  edges,
  allTasks,
  ownerName,
  onOpenTask,
}: {
  task: RoadmapTask;
  edges: TaskEdge[];
  allTasks: RoadmapTask[];
  ownerName: (id: string | null) => string;
  onOpenTask: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const blocker = task.dependency_id
    ? allTasks.find((t) => t.id === task.dependency_id)
    : null;

  // A task is only genuinely blocked if what it waits on is not finished.
  const waitingOn = edges
    .map((e) => ({ edge: e, on: allTasks.find((t) => t.id === e.to_id) }))
    .filter((x) => x.on);
  const unmet = waitingOn.filter((x) => x.on!.status !== "completed").length;
  const count = waitingOn.length;

  const overdue =
    !!task.due_date &&
    task.due_date.slice(0, 10) < new Date().toISOString().slice(0, 10) &&
    task.status !== "completed" &&
    task.status !== "cancelled";

  return (
    <div>
      {/* Not a button: a disabled <button> swallows pointer events for its whole
          subtree, which stopped tasks with no blockers from opening at all. */}
      <div className="flex w-full items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2">
        {count > 0 ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "Hide blockers" : "Show blockers"}
            aria-expanded={open}
            className="w-3 shrink-0 text-[10px] text-faint hover:text-fg"
          >
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}

        <span className="w-14 shrink-0 font-mono text-[11px] text-faint">{task.code}</span>

        <button
          type="button"
          onClick={() => onOpenTask(task.id)}
          className="min-w-0 flex-1 truncate text-left text-sm text-fg hover:text-brand hover:underline"
        >
          {task.title}
        </button>

        {count > 0 && (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              unmet > 0 ? "bg-amber-50 text-amber-700" : "bg-green-50 text-green-700"
            }`}
          >
            {unmet > 0 ? `waits on ${unmet}` : "clear"}
          </span>
        )}
        {task.estimate_hours != null && (
          <span className="hidden shrink-0 text-[11px] tabular-nums text-faint sm:inline">
            {task.estimate_hours}h
          </span>
        )}
        <span className="hidden w-28 shrink-0 truncate text-xs text-muted md:inline">
          {ownerName(task.owner_id)}
        </span>
        <span className={`hidden w-24 shrink-0 text-xs tabular-nums md:inline ${overdue ? "font-semibold text-red-600" : "text-muted"}`}>
          {shortDate(task.due_date)}
        </span>
        <PriorityBadge priority={task.priority} />
        <StatusBadge status={task.status} />
      </div>

      {open && count > 0 && (
        <div className="border-t border-line/60 bg-ink/30 px-4 py-3 pl-[4.5rem]">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
            Waits on
          </p>
          <ul className="space-y-1.5">
            {waitingOn.map(({ edge, on }) => {
              const done = on!.status === "completed";
              return (
                <li key={edge.id} className="flex items-start gap-2.5 text-xs">
                  <span
                    className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${done ? "bg-green-500" : "bg-amber-500"}`}
                  />
                  <span className="min-w-0">
                    <span className="font-mono text-[11px] text-faint">{on!.code}</span>{" "}
                    <span className={done ? "text-muted line-through" : "text-fg"}>{on!.title}</span>
                    {blocker?.id === on!.id && (
                      <span className="ml-1.5 rounded bg-brand/10 px-1 py-0.5 text-[10px] font-medium text-brand-soft">
                        critical path
                      </span>
                    )}
                    {edge.note && <span className="block text-faint">{edge.note}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
