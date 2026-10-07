"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "@/components/Toast";
import { Card, KpiCard, EmptyState } from "@/components/os/ui";
import { Modal, Field, Input, Select, Textarea, FormActions } from "@/components/os/Modal";
import { shortDate } from "@/lib/bos";
import { saveFeedback } from "@/lib/team-actions";

export type Feedback = {
  id: string; source_type: string | null; rating: number | null;
  feedback: string; issue: string | null; owner_id: string | null;
  action: string | null; resolution: string | null; retention_risk: string | null;
  created_at: string;
};

type Person = { id: string; full_name: string | null; email: string | null };

const RISK_TONE: Record<string, string> = {
  high: "bg-red-100 text-red-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-surface-2 text-muted",
};

/**
 * What people told us, and whether anything happened as a result.
 *
 * Feedback is only worth collecting if it changes something, so a piece with
 * no action against it is the thing the page counts first — and sits visibly
 * unanswered rather than blending into the list.
 */
export function FeedbackClient({ rows, people }: { rows: Feedback[]; people: Person[] }) {
  const [editing, setEditing] = useState<Feedback | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<"all" | "unactioned" | "risk">("all");

  const nameOf = (id: string | null) => people.find((p) => p.id === id)?.full_name ?? "Nobody";

  const stats = useMemo(() => {
    const rated = rows.filter((r) => r.rating != null);
    return {
      total: rows.length,
      unactioned: rows.filter((r) => !r.action?.trim()).length,
      atRisk: rows.filter((r) => (r.retention_risk ?? "").toLowerCase() === "high").length,
      avg: rated.length ? rated.reduce((a, r) => a + (r.rating ?? 0), 0) / rated.length : null,
    };
  }, [rows]);

  const shown = useMemo(() => {
    if (filter === "unactioned") return rows.filter((r) => !r.action?.trim());
    if (filter === "risk") return rows.filter((r) => (r.retention_risk ?? "").toLowerCase() === "high");
    return rows;
  }, [rows, filter]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg">Feedback</h1>
          <p className="max-w-3xl text-sm text-muted">
            What people told us, and what changed because of it. Feedback nobody acts on is just a
            record of being told.
          </p>
        </div>
        <button onClick={() => setCreating(true)} className="shrink-0 rounded-full bg-brand px-4 py-2 text-sm font-medium text-white">
          + Log feedback
        </button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Pieces logged" value={String(stats.total)} />
        <KpiCard label="Nothing done yet" value={String(stats.unactioned)} tone={stats.unactioned ? "warn" : "good"} />
        <KpiCard label="At risk of leaving" value={String(stats.atRisk)} tone={stats.atRisk ? "bad" : "good"} />
        <KpiCard label="Average rating" value={stats.avg != null ? `${stats.avg.toFixed(1)} / 5` : "—"}
          tone={stats.avg != null && stats.avg < 3 ? "warn" : "default"} />
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {([["all", `Everything (${rows.length})`], ["unactioned", `Unanswered (${stats.unactioned})`], ["risk", `At risk (${stats.atRisk})`]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              filter === k ? "bg-brand text-white" : "border border-line text-muted hover:text-fg"}`}>
            {label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState
          title={rows.length === 0 ? "No feedback logged" : "Nothing in this view"}
          hint="Log what people say at events, in replies, and on the way out — especially on the way out." />
      ) : (
        <div className="space-y-2">
          {shown.map((r) => {
            const answered = !!r.action?.trim();
            return (
              <Card key={r.id} className="!p-0">
                <div className="flex flex-wrap items-start gap-3 border-b border-line px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-fg">{r.feedback}</p>
                    <p className="mt-1 text-[11px] text-faint">
                      {r.source_type || "Unattributed"} · {shortDate(r.created_at)}
                      {r.issue ? ` · ${r.issue}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {r.rating != null && (
                      <span className="text-xs text-muted">{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span>
                    )}
                    {r.retention_risk && (
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${RISK_TONE[r.retention_risk.toLowerCase()] ?? "bg-surface-2 text-muted"}`}>
                        {r.retention_risk} risk
                      </span>
                    )}
                  </div>
                </div>
                <div className={`px-4 py-2.5 ${answered ? "" : "bg-amber-500/5"}`}>
                  {answered ? (
                    <>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
                        What we did · {nameOf(r.owner_id)}
                      </p>
                      <p className="text-sm text-fg">{r.action}</p>
                      {r.resolution && <p className="mt-0.5 text-xs text-muted">{r.resolution}</p>}
                    </>
                  ) : (
                    <button onClick={() => setEditing(r)} className="text-sm text-amber-700 hover:underline">
                      Nothing done about this yet — decide what happens
                    </button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <FeedbackForm open={creating || !!editing} item={editing} people={people}
        onClose={() => { setCreating(false); setEditing(null); }} />
    </>
  );
}

function FeedbackForm({
  open, item, people, onClose,
}: { open: boolean; item: Feedback | null; people: Person[]; onClose: () => void }) {
  const [saving, start] = useTransition();
  const [form, setForm] = useState(() => ({
    source_type: item?.source_type ?? "", rating: item?.rating != null ? String(item.rating) : "",
    feedback: item?.feedback ?? "", issue: item?.issue ?? "",
    owner_id: item?.owner_id ?? "", action: item?.action ?? "",
    resolution: item?.resolution ?? "", retention_risk: item?.retention_risk ?? "",
  }));
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal open={open} onClose={onClose} title={item ? "Edit feedback" : "Log feedback"} wide>
      <form onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await saveFeedback(item?.id ?? null, {
            ...form, rating: form.rating === "" ? null : form.rating,
          });
          if ("error" in res && res.error) toast(res.error, "error");
          else { toast("Saved", "success"); onClose(); }
        });
      }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="What they said"><Textarea rows={3} value={form.feedback} onChange={(e) => set("feedback", e.target.value)} required /></Field>
          </div>
          <Field label="Where it came from">
            <Select value={form.source_type} onChange={(e) => set("source_type", e.target.value)}>
              <option value="">Not recorded</option>
              {["Event", "Member", "Host", "Survey", "Support", "Social"].map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Rating">
            <Select value={form.rating} onChange={(e) => set("rating", e.target.value)}>
              <option value="">Not rated</option>
              {[5,4,3,2,1].map((n) => <option key={n} value={n}>{"★".repeat(n)}</option>)}
            </Select>
          </Field>
          <Field label="The underlying issue"><Input value={form.issue} onChange={(e) => set("issue", e.target.value)} /></Field>
          <Field label="Risk of them leaving">
            <Select value={form.retention_risk} onChange={(e) => set("retention_risk", e.target.value)}>
              <option value="">Not assessed</option>
              {["low", "medium", "high"].map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="What we are doing about it — the part that matters">
              <Textarea rows={2} value={form.action} onChange={(e) => set("action", e.target.value)} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="How it ended"><Textarea rows={2} value={form.resolution} onChange={(e) => set("resolution", e.target.value)} /></Field>
          </div>
          <Field label="Who owns it">
            <Select value={form.owner_id} onChange={(e) => set("owner_id", e.target.value)}>
              <option value="">Nobody</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
            </Select>
          </Field>
        </div>
        <FormActions onCancel={onClose} saving={saving} submitLabel="Save" />
      </form>
    </Modal>
  );
}
