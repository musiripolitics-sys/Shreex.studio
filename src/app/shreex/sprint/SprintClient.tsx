"use client";

import { useState, useTransition } from "react";
import { toast } from "@/components/Toast";
import { PageHead, StatStrip, Stat, Queue, Row, Split } from "@/components/os/dense";
import { shortDate } from "@/lib/bos";
import type { SprintMetrics, SprintHistoryRow, SprintNote } from "@/lib/os-sprints";
import {
  startSprint, closeSprint, setSprintGoal, addSprintNote, deleteSprintNote, setTaskSprint,
} from "../actions";

export type Story = {
  id: string;
  code: string;
  title: string;
  status: string;
  priority: string;
  owner: string | null;
  due_date: string | null;
  estimate_hours: number | null;
  actual_hours: number | null;
};

const STATUS_TONE: Record<string, "plain" | "good" | "warn" | "bad"> = {
  completed: "good",
  in_progress: "plain",
  not_started: "plain",
  blocked: "bad",
  cancelled: "plain",
};

const CEREMONY = [
  { kind: "refinement", label: "Refinement", when: "Monday", hint: "What are we committing to, and is any of it too big?" },
  { kind: "review", label: "Review", when: "Friday", hint: "What did we actually ship?" },
  { kind: "retro_good", label: "Went well", when: "Friday", hint: "" },
  { kind: "retro_bad", label: "Did not", when: "Friday", hint: "" },
  { kind: "retro_action", label: "Actions", when: "Friday", hint: "The part that makes it a retrospective rather than a conversation" },
] as const;

/**
 * Red, amber, green for the week — computed here so the rule is visible.
 *
 * Against the clock rather than the raw percentage: a sprint on day 4 of 5
 * with half its hours left is in trouble whatever "50% done" suggests.
 */
function rag(m: SprintMetrics): { tone: "good" | "warn" | "bad"; why: string } {
  const committed = m.committed_hours ?? 0;
  const done = m.done_hours ?? 0;
  const day = Math.min(m.day ?? 1, 5);
  if (!m.sprint) return { tone: "warn", why: "no sprint started" };
  if ((m.blocked ?? 0) > 0) return { tone: "bad", why: `${m.blocked} blocked` };
  if (committed === 0) return { tone: "warn", why: "nothing committed" };
  const expected = committed * (day / 5);
  if (done >= expected) return { tone: "good", why: "ahead of the burn" };
  const behind = Math.round(((expected - done) / committed) * 100);
  return behind > 25 ? { tone: "bad", why: `${behind}% behind` } : { tone: "warn", why: `${behind}% behind` };
}

export function SprintClient({
  metrics, history, notes, stories, backlog, migrated,
}: {
  metrics: SprintMetrics;
  history: SprintHistoryRow[];
  notes: SprintNote[];
  stories: Story[];
  backlog: Story[];
  migrated: boolean;
}) {
  const [saving, start] = useTransition();
  const [goal, setGoal] = useState(metrics.goal ?? "");
  const [editingGoal, setEditingGoal] = useState(false);
  const m = metrics;
  const light = rag(m);

  const run = (fn: () => Promise<{ error?: string } | { success: boolean }>, ok: string) =>
    start(async () => {
      const res = await fn();
      if (res && "error" in res && res.error) toast(res.error, "error");
      else toast(ok, "success");
    });

  if (!migrated) {
    return (
      <>
        <PageHead title="Sprint" />
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
          <strong>Migration 0056 has not run.</strong> Sprints, the ceremonies and the velocity
          history all come from it. Run <code className="font-mono text-[12px]">0056_sprints.sql</code> in
          the Supabase SQL editor.
        </div>
      </>
    );
  }

  if (!m.sprint) {
    return (
      <>
        <PageHead title="Sprint" context="no week planned yet" />
        <div className="rounded-lg border border-line bg-surface px-4 py-6 text-center">
          <p className="text-[13px] font-medium text-fg">This week has not been planned.</p>
          <p className="mx-auto mt-1 max-w-md text-[12px] text-muted">
            A sprint runs Monday to Sunday and every product feeds the same one. Starting it creates
            the week; pulling work in is the next thing, and that is what Monday refinement is for.
          </p>
          <button
            type="button"
            disabled={saving}
            onClick={() => run(() => startSprint(), "Sprint started")}
            className="mt-3 rounded-full bg-brand px-4 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Starting…" : "Start this week"}
          </button>
        </div>
      </>
    );
  }

  const byStatus = (s: string) => stories.filter((x) => x.status === s);
  const burnPct = (m.committed_hours ?? 0) > 0
    ? Math.round(((m.done_hours ?? 0) / (m.committed_hours ?? 1)) * 100) : 0;
  const clockPct = Math.round((Math.min(m.day ?? 1, 5) / 5) * 100);

  return (
    <>
      <PageHead
        title={`Sprint ${m.number}`}
        context={`${shortDate(m.starts_on)} – ${shortDate(m.ends_on)} · day ${m.day} of 7 · ${m.status}`}
        actions={
          m.status !== "closed" ? (
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                start(async () => {
                  const res = await closeSprint();
                  if ("error" in res && res.error) return toast(res.error, "error");
                  const c = (res as { carried: number }).carried;
                  toast(c > 0 ? `Week closed. ${c} carried into next week.` : "Week closed, nothing carried.", "success");
                })
              }
              className="rounded border border-line px-2.5 py-1 text-[12px] font-medium text-muted hover:border-brand hover:text-brand disabled:opacity-50"
            >
              Close the week
            </button>
          ) : undefined
        }
      />

      {/*
        Throughput never travels alone. Velocity rising while quality falls is
        worse than no metric, so carry-over, overrun and unestimated sit beside
        the hours rather than behind a tab.
      */}
      <StatStrip>
        <Stat
          label="Burn"
          value={`${burnPct}%`}
          tone={light.tone}
          hint={`${m.done_hours ?? 0}h of ${m.committed_hours ?? 0}h · clock ${clockPct}% · ${light.why}`}
        />
        <Stat
          label="Stories"
          value={`${m.done ?? 0}/${m.stories ?? 0}`}
          tone={(m.blocked ?? 0) > 0 ? "bad" : "plain"}
          hint={`${m.in_progress ?? 0} in progress · ${m.blocked ?? 0} blocked`}
        />
        <Stat
          label="Unestimated"
          value={m.unestimated ?? 0}
          tone={(m.unestimated ?? 0) > 0 ? "warn" : "good"}
          hint={(m.unestimated ?? 0) > 0 ? "burn is guesswork until these are sized" : "everything sized"}
        />
        <Stat
          label="Overrun"
          value={`${m.overrun_hours ?? 0}h`}
          tone={(m.overrun_hours ?? 0) > (m.committed_hours ?? 0) * 0.2 ? "warn" : "plain"}
          hint="actual past estimate on finished work"
        />
      </StatStrip>

      {/* The one line that says what the week is for. */}
      <div className="mb-4 rounded-lg border border-line bg-surface px-3.5 py-2.5">
        {editingGoal ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              autoFocus
              placeholder="What is this week for?"
              className="min-w-[16rem] flex-1 rounded border border-line bg-surface px-2 py-1 text-[13px] text-fg outline-none focus:border-brand"
            />
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                run(() => setSprintGoal(m.sprint!, goal), "Goal set");
                setEditingGoal(false);
              }}
              className="rounded-full border border-brand px-3 py-1 text-[12px] font-semibold text-brand"
            >
              Save
            </button>
            <button type="button" onClick={() => setEditingGoal(false)} className="text-[12px] text-faint">
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setEditingGoal(true)} className="w-full text-left">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-faint">Sprint goal</span>
            <span className="mt-0.5 block text-[13px] text-fg">
              {m.goal || <span className="text-faint">Not set — a week without one is a list of tasks. Click to write it.</span>}
            </span>
          </button>
        )}
      </div>

      <Split
        main={
          <>
            {(["blocked", "in_progress", "not_started", "completed"] as const).map((s) => {
              const rows = byStatus(s);
              const titles: Record<string, string> = {
                blocked: "Blocked", in_progress: "In progress",
                not_started: "Not started", completed: "Done",
              };
              return (
                <Queue
                  key={s}
                  title={titles[s]}
                  count={rows.length}
                  tone={s === "blocked" ? "bad" : s === "completed" ? "good" : "plain"}
                  empty={s === "blocked" ? "Nothing blocked." : "Nothing here."}
                >
                  {rows.map((t) => (
                    <Row
                      key={t.id}
                      href={`/shreex/tasks?task=${t.id}`}
                      primary={t.title}
                      secondary={[t.owner, t.code].filter(Boolean).join(" · ")}
                      meta={
                        t.estimate_hours == null
                          ? "unsized"
                          : `${t.estimate_hours}h${t.actual_hours ? ` / ${t.actual_hours}h` : ""}`
                      }
                      tone={t.estimate_hours == null ? "warn" : STATUS_TONE[t.status] ?? "plain"}
                    />
                  ))}
                </Queue>
              );
            })}

            {/*
              The backlog, on the page rather than behind a link, because
              Monday refinement is pulling from it and a backlog you have to
              navigate to is a backlog people keep in their heads.
            */}
            <Queue
              title="Backlog"
              count={backlog.length}
              href="/shreex/tasks"
              hrefLabel="All tasks"
              empty="Nothing waiting."
            >
              {backlog.slice(0, 8).map((t) => (
                <div key={t.id} className="flex min-h-[32px] items-center gap-2.5 px-3.5 py-1.5 text-[13px] hover:bg-surface-2">
                  <span className="min-w-0 flex-1 truncate text-fg">{t.title}</span>
                  <span className="shrink-0 text-[12px] text-faint">
                    {t.estimate_hours == null ? "unsized" : `${t.estimate_hours}h`}
                  </span>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => run(() => setTaskSprint(t.id, m.sprint!), "Pulled into the sprint")}
                    className="shrink-0 rounded border border-line px-2 py-0.5 text-[11px] font-medium text-muted hover:border-brand hover:text-brand disabled:opacity-50"
                  >
                    Pull in
                  </button>
                </div>
              ))}
            </Queue>
          </>
        }
        aside={
          <>
            <Ceremonies sprintId={m.sprint} notes={notes} saving={saving} run={run} start={start} />

            <Queue title="Velocity" count={history.length} empty="No closed sprints yet.">
              {history.map((h) => (
                <div key={h.id} className="flex min-h-[32px] items-center gap-2.5 px-3.5 py-1.5 text-[13px]">
                  <span className="w-14 shrink-0 text-faint">#{h.number}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-muted">
                    {h.done}/{h.stories} stories
                    {h.carried_out != null && h.carried_out > 0 && ` · ${h.carried_out} carried`}
                  </span>
                  <span className="shrink-0 tabular-nums text-[12px] text-fg">{h.done_hours}h</span>
                </div>
              ))}
            </Queue>
          </>
        }
      />
    </>
  );
}

/** Refinement, review and the retrospective, as records. */
function Ceremonies({
  sprintId, notes, saving, run, start,
}: {
  sprintId: string;
  notes: SprintNote[];
  saving: boolean;
  run: (fn: () => Promise<{ error?: string } | { success: boolean }>, ok: string) => void;
  start: (fn: () => Promise<void>) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [body, setBody] = useState("");

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface">
      <header className="border-b border-line px-3.5 py-2">
        <h2 className="text-[12px] font-semibold text-fg">Ceremonies</h2>
      </header>
      <div className="divide-y divide-line">
        {CEREMONY.map((c) => {
          const mine = notes.filter((n) => n.kind === c.kind);
          return (
            <div key={c.kind} className="px-3.5 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-medium text-fg">
                  {c.label}
                  <span className="ml-1.5 text-[11px] font-normal text-faint">{c.when}</span>
                </span>
                <button
                  type="button"
                  onClick={() => { setOpen(open === c.kind ? null : c.kind); setBody(""); }}
                  className="text-[11px] text-faint hover:text-brand"
                >
                  {open === c.kind ? "Cancel" : "+ Add"}
                </button>
              </div>
              {mine.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {mine.map((n) => (
                    <li key={n.id} className="group flex items-start gap-2 text-[12px] text-muted">
                      <span className="min-w-0 flex-1">{n.body}</span>
                      <button
                        type="button"
                        onClick={() => run(() => deleteSprintNote(n.id), "Removed")}
                        className="shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-600"
                        aria-label="Remove note"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {open === c.kind && (
                <form
                  action={(fd) =>
                    start(async () => {
                      const res = await addSprintNote(fd);
                      if ("error" in res && res.error) return toast(res.error, "error");
                      setBody("");
                      setOpen(null);
                    })
                  }
                  className="mt-1.5 flex gap-1.5"
                >
                  <input type="hidden" name="sprintId" value={sprintId} />
                  <input type="hidden" name="kind" value={c.kind} />
                  <input
                    name="body"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    autoFocus
                    placeholder={c.hint || "…"}
                    className="min-w-0 flex-1 rounded border border-line bg-surface px-2 py-1 text-[12px] text-fg outline-none focus:border-brand"
                  />
                  <button
                    type="submit"
                    disabled={saving || !body.trim()}
                    className="shrink-0 rounded-full bg-brand px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                  >
                    Add
                  </button>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
