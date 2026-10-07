"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "@/components/Toast";
import { Card, KpiCard, EmptyState } from "@/components/os/ui";
import { Field, Input, Textarea, Select, FormActions } from "@/components/os/Modal";
import { shortDate } from "@/lib/bos";
import { saveTaskReview } from "./actions";

export type ReviewComment = { id: string; body: string; created_at: string; author: string | null };

export type TaskReview = {
  task_id: string;
  code: string | null;
  title: string;
  description: string | null;
  completed_at: string | null;
  due_date: string | null;
  priority: string | null;
  owner_name: string | null;
  goal_code: string | null;
  goal_objective: string | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
  comments: ReviewComment[];
  outcome: "pending" | "met" | "partial" | "missed";
  estimate_hours: number | null;
  actual_hours: number | null;
  variance_hours: number | null;
  quality: number | null;
  what_worked: string | null;
  what_failed: string | null;
  learning: string | null;
};

const OUTCOMES = [
  { value: "pending", label: "Not reviewed yet" },
  { value: "met", label: "Met the goal" },
  { value: "partial", label: "Partially met" },
  { value: "missed", label: "Missed" },
] as const;

const OUTCOME_TONE: Record<TaskReview["outcome"], string> = {
  pending: "bg-amber-100 text-amber-700",
  met: "bg-green-100 text-green-700",
  partial: "bg-blue-100 text-blue-700",
  missed: "bg-red-100 text-red-700",
};

/**
 * One review per completed task: what it was estimated at, what it actually
 * took, and what we learned. The weekly/monthly retro on the other tab answers
 * "how did the period go"; this answers "how did this piece of work go".
 */
export function TaskReviewsClient({ reviews }: { reviews: TaskReview[] }) {
  const pending = reviews.filter((r) => r.outcome === "pending");
  const done = reviews.filter((r) => r.outcome !== "pending");

  const withBoth = reviews.filter((r) => r.estimate_hours != null && r.actual_hours != null);
  const estimated = withBoth.reduce((a, r) => a + Number(r.estimate_hours ?? 0), 0);
  const actual = withBoth.reduce((a, r) => a + Number(r.actual_hours ?? 0), 0);
  const accuracy = estimated > 0 ? Math.round((estimated / actual) * 100) : null;

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Completed tasks" value={reviews.length} />
        <KpiCard
          label="Awaiting review"
          value={pending.length}
          tone={pending.length > 0 ? "warn" : "good"}
        />
        <KpiCard
          label="Hours estimated vs actual"
          value={withBoth.length ? `${estimated}h → ${actual}h` : "No data yet"}
          sub={withBoth.length ? `across ${withBoth.length} reviewed task${withBoth.length === 1 ? "" : "s"}` : undefined}
        />
        <KpiCard
          label="Estimate accuracy"
          value={accuracy != null ? `${accuracy}%` : "No data yet"}
          tone={accuracy == null ? "default" : accuracy >= 80 && accuracy <= 125 ? "good" : "warn"}
          sub={accuracy != null ? (accuracy < 100 ? "We under-estimate" : "We over-estimate") : undefined}
        />
      </div>

      {reviews.length === 0 ? (
        <EmptyState
          title="No completed tasks yet"
          hint="A review opens automatically the moment a task is marked completed."
          action={
            <Link href="/shreex/tasks" className="rounded-full bg-brand px-4 py-2 text-sm font-medium text-white">
              Open tasks
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {[...pending, ...done].map((r) => (
            <ReviewRow key={r.task_id} review={r} />
          ))}
        </div>
      )}
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-faint">{label}</dt>
      <dd className="text-fg">{children}</dd>
    </div>
  );
}

function ReviewRow({ review }: { review: TaskReview }) {
  const [open, setOpen] = useState(review.outcome === "pending");
  const [saving, start] = useTransition();
  const [form, setForm] = useState({
    outcome: review.outcome,
    actual_hours: review.actual_hours?.toString() ?? "",
    quality: review.quality?.toString() ?? "",
    what_worked: review.what_worked ?? "",
    what_failed: review.what_failed ?? "",
    learning: review.learning ?? "",
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const res = await saveTaskReview({
        task_id: review.task_id,
        outcome: form.outcome,
        actual_hours: form.actual_hours ? Number(form.actual_hours) : null,
        quality: form.quality ? Number(form.quality) : null,
        what_worked: form.what_worked || null,
        what_failed: form.what_failed || null,
        learning: form.learning || null,
      });
      if ("error" in res && res.error) toast(res.error, "error");
      else {
        toast("Review saved", "success");
        setOpen(false);
      }
    });
  };

  const est = review.estimate_hours;
  const act = form.actual_hours ? Number(form.actual_hours) : review.actual_hours;
  const variance = est != null && act != null ? act - est : null;

  // Hours tell you the effort; this tells you whether it landed when it was
  // meant to, which is the other half of how the work went.
  const lateness = (() => {
    if (!review.due_date || !review.completed_at) return null;
    const days = Math.round(
      (new Date(review.completed_at.slice(0, 10)).getTime() -
        new Date(review.due_date.slice(0, 10)).getTime()) /
        86400000,
    );
    if (days > 0) return { text: `${days} day${days === 1 ? "" : "s"} late`, cls: "text-red-600" };
    if (days < 0) return { text: `${-days} day${days === -1 ? "" : "s"} early`, cls: "text-green-600" };
    return { text: "on time", cls: "text-green-600" };
  })();

  return (
    <Card className="!p-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-5 py-3.5 text-left"
      >
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${OUTCOME_TONE[review.outcome]}`}>
          {OUTCOMES.find((o) => o.value === review.outcome)?.label}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-fg">
            {review.code && <span className="mr-1.5 font-mono text-[11px] text-faint">{review.code}</span>}
            {review.title}
          </span>
          <span className="block truncate text-[11px] text-faint">
            {review.owner_name ?? "Unassigned"}
            {review.goal_objective && ` · ${review.goal_code ?? ""} ${review.goal_objective}`}
          </span>
        </span>
        {review.completed_at && (
          <span className="hidden shrink-0 text-right text-xs sm:block">
            <span className="block text-faint">done {shortDate(review.completed_at)}</span>
            {lateness && <span className={`block ${lateness.cls}`}>{lateness.text}</span>}
          </span>
        )}
        <span className="shrink-0 text-xs tabular-nums text-muted">
          {est != null ? `${est}h est` : "no estimate"}
          {variance != null && (
            <span className={variance > 0 ? "text-red-600" : "text-green-600"}>
              {" "}· {variance > 0 ? "+" : ""}
              {variance}h
            </span>
          )}
        </span>
      </button>

      {open && (
        <div className="border-t border-line px-5 py-4">
          <div className="mb-4 grid gap-4 md:grid-cols-[1.1fr_1fr]">
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
                What the task asked for
              </p>
              <p className="text-xs leading-relaxed text-muted">
                {review.description || "No description was written on this task."}
              </p>

              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <Fact label="Assignee">{review.owner_name ?? "Unassigned"}</Fact>
                <Fact label="Priority">{review.priority ?? "—"}</Fact>
                <Fact label="Due">{review.due_date ? shortDate(review.due_date) : "—"}</Fact>
                <Fact label="Completed">
                  {review.completed_at ? shortDate(review.completed_at) : "—"}
                  {lateness && <span className={`ml-1 ${lateness.cls}`}>({lateness.text})</span>}
                </Fact>
                <Fact label="Goal">
                  {review.goal_objective ? `${review.goal_code ?? ""} ${review.goal_objective}` : "Not on the roadmap"}
                </Fact>
                <Fact label="Reviewed by">
                  {review.reviewer_name
                    ? `${review.reviewer_name}${review.reviewed_at ? ` · ${shortDate(review.reviewed_at)}` : ""}`
                    : "Not yet"}
                </Fact>
              </dl>
            </div>

            <div className="min-w-0">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
                What was actually done ({review.comments.length})
              </p>
              {review.comments.length === 0 ? (
                <p className="text-xs text-faint">
                  No comments. Since the completion gate, work cannot be closed without one,
                  so this task predates it.
                </p>
              ) : (
                <ul className="max-h-44 space-y-2 overflow-y-auto pr-1">
                  {review.comments.map((c) => (
                    <li key={c.id} className="rounded-lg bg-surface-2 px-2.5 py-1.5">
                      <p className="text-[10px] text-faint">
                        {c.author ?? "Someone"} · {shortDate(c.created_at)}
                      </p>
                      <p className="whitespace-pre-wrap text-xs text-fg">{c.body}</p>
                    </li>
                  ))}
                </ul>
              )}
              <Link
                href={`/shreex/tasks?task=${review.task_id}`}
                className="mt-2 inline-block text-[11px] font-medium text-brand-soft hover:underline"
              >
                Open the task →
              </Link>
            </div>
          </div>

        <form onSubmit={submit} className="border-t border-line pt-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Outcome">
              <Select
                value={form.outcome}
                onChange={(e) => setForm({ ...form, outcome: e.target.value as TaskReview["outcome"] })}
              >
                {OUTCOMES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={`Actual hours${est != null ? ` (estimated ${est}h)` : ""}`}>
              <Input
                type="number"
                min={0}
                step="0.5"
                value={form.actual_hours}
                onChange={(e) => setForm({ ...form, actual_hours: e.target.value })}
              />
            </Field>
            <Field label="Quality (1–5)">
              <Select value={form.quality} onChange={(e) => setForm({ ...form, quality: e.target.value })}>
                <option value="">Not rated</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="What worked">
              <Textarea rows={2} value={form.what_worked} onChange={(e) => setForm({ ...form, what_worked: e.target.value })} />
            </Field>
            <Field label="What didn't">
              <Textarea rows={2} value={form.what_failed} onChange={(e) => setForm({ ...form, what_failed: e.target.value })} />
            </Field>
            <Field label="Learning to carry forward">
              <Textarea rows={2} value={form.learning} onChange={(e) => setForm({ ...form, learning: e.target.value })} />
            </Field>
          </div>
          <FormActions onCancel={() => setOpen(false)} saving={saving} submitLabel="Save review" />
        </form>
        </div>
      )}
    </Card>
  );
}
