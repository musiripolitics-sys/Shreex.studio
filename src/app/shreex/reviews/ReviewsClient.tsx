"use client";

import { useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { toast } from "@/components/Toast";
import { Card, KpiCard, SectionHeading } from "@/components/os/ui";
import { Field, Textarea, FormActions } from "@/components/os/Modal";
import { inrCompact, num, pct, shortDate } from "@/lib/bos";
import { saveReview } from "./actions";

export type ReviewMetrics = {
  planned: number;
  completed: number;
  missed: number;
  inProgress: number;
  budgetUsed: number;
  revenue: number;
  kpiTarget: number;
  kpiActual: number;
};

export type ReviewNotes = {
  what_worked: string | null;
  what_failed: string | null;
  why_text: string | null;
  corrective_action: string | null;
  next_priority: string | null;
} | null;

export function ReviewsClient({
  type,
  start,
  end,
  metrics,
  notes,
}: {
  type: "week" | "month";
  start: string;
  end: string;
  metrics: ReviewMetrics;
  notes: ReviewNotes;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startT] = useTransition();

  const [form, setForm] = useState({
    what_worked: notes?.what_worked ?? "",
    what_failed: notes?.what_failed ?? "",
    why_text: notes?.why_text ?? "",
    corrective_action: notes?.corrective_action ?? "",
    next_priority: notes?.next_priority ?? "",
  });

  const go = (next: { type?: string; start?: string }) => {
    const sp = new URLSearchParams();
    sp.set("type", next.type ?? type);
    if (next.start ?? start) sp.set("start", next.start ?? start);
    router.push(`${pathname}?${sp.toString()}`);
  };

  const completionRate = metrics.planned > 0 ? (metrics.completed / metrics.planned) * 100 : 0;
  const kpiAch = metrics.kpiTarget > 0 ? (metrics.kpiActual / metrics.kpiTarget) * 100 : 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startT(async () => {
      const res = await saveReview({ period_type: type, period_start: start, ...form });
      if (res?.error) toast(res.error, "error");
      else toast("Review saved", "success");
    });
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg">
            {type === "week" ? "Weekly" : "Monthly"} Review
          </h1>
          <p className="text-sm text-muted">
            {shortDate(start)} → {shortDate(end)} · planned vs done, budget, revenue and KPIs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-full border border-line bg-surface p-0.5">
            {(["week", "month"] as const).map((t) => (
              <button
                key={t}
                onClick={() => go({ type: t, start: "" })}
                className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
                  type === t ? "bg-brand text-white" : "text-muted hover:text-fg"
                }`}
              >
                {t}ly
              </button>
            ))}
          </div>
          {type === "week" ? (
            <input
              type="date"
              value={start}
              onChange={(e) => go({ start: e.target.value })}
              className="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-fg"
              aria-label="Week start"
            />
          ) : (
            <input
              type="month"
              value={start.slice(0, 7)}
              onChange={(e) => go({ start: `${e.target.value}-01` })}
              className="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-fg"
              aria-label="Month"
            />
          )}
        </div>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        <KpiCard label="Planned" value={num(metrics.planned)} />
        <KpiCard label="Completed" value={num(metrics.completed)} tone="good" />
        <KpiCard label="Completion" value={pct(completionRate)} tone={completionRate >= 80 ? "good" : "warn"} />
        <KpiCard label="Missed" value={num(metrics.missed)} tone={metrics.missed ? "bad" : "good"} />
        <KpiCard label="Budget used" value={inrCompact(metrics.budgetUsed)} tone="warn" />
        <KpiCard label="Revenue" value={inrCompact(metrics.revenue)} tone="good" />
        <KpiCard label="KPI achieved" value={metrics.kpiTarget > 0 ? pct(kpiAch) : "—"} tone={kpiAch >= 100 ? "good" : "default"} />
      </div>

      <SectionHeading title="Retrospective" desc="What worked, what didn't, and what changes next period" />
      <Card>
        <form onSubmit={submit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="What worked">
            <Textarea rows={3} value={form.what_worked} onChange={(e) => setForm({ ...form, what_worked: e.target.value })} />
          </Field>
          <Field label="What failed">
            <Textarea rows={3} value={form.what_failed} onChange={(e) => setForm({ ...form, what_failed: e.target.value })} />
          </Field>
          <Field label="Why">
            <Textarea rows={3} value={form.why_text} onChange={(e) => setForm({ ...form, why_text: e.target.value })} />
          </Field>
          <Field label="Corrective action">
            <Textarea rows={3} value={form.corrective_action} onChange={(e) => setForm({ ...form, corrective_action: e.target.value })} />
          </Field>
          <div className="md:col-span-2">
            <Field label={type === "week" ? "Focus for next week" : "Next month's priority"}>
              <Textarea rows={2} value={form.next_priority} onChange={(e) => setForm({ ...form, next_priority: e.target.value })} />
            </Field>
          </div>
          <div className="md:col-span-2">
            <FormActions onCancel={() => setForm({
              what_worked: notes?.what_worked ?? "",
              what_failed: notes?.what_failed ?? "",
              why_text: notes?.why_text ?? "",
              corrective_action: notes?.corrective_action ?? "",
              next_priority: notes?.next_priority ?? "",
            })} saving={pending} submitLabel="Save review" />
          </div>
        </form>
      </Card>
    </>
  );
}
