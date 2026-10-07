"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "@/components/Toast";
import { Card, KpiCard, EmptyState } from "@/components/os/ui";
import { Modal, Field, Input, Textarea, FormActions } from "@/components/os/Modal";
import { shortDate } from "@/lib/bos";
import { saveCompetitor } from "@/lib/marketing-actions";

export type Competitor = {
  id: string; name: string; category: string | null; offer: string | null;
  business_model: string | null; pricing: string | null; target_audience: string | null;
  strengths: string | null; gaps: string | null; our_response: string | null;
  review_date: string | null;
};

const daysUntil = (d: string | null) =>
  d ? Math.ceil((new Date(d).getTime() - Date.now()) / 86400000) : null;

/**
 * Competitors, arranged around the only question that changes anything.
 *
 * Knowing what somebody else does is research; knowing what we do about it is
 * strategy. So every card leads with our response, and one without a response
 * is counted on the page rather than looking the same as the rest — notes
 * nobody acts on are the usual fate of a competitor register.
 */
export function CompetitorsClient({ competitors }: { competitors: Competitor[] }) {
  const [editing, setEditing] = useState<Competitor | null>(null);
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState("");

  const stats = useMemo(() => ({
    total: competitors.length,
    unanswered: competitors.filter((c) => !c.our_response?.trim()).length,
    stale: competitors.filter((c) => {
      const d = daysUntil(c.review_date);
      return d !== null && d < 0;
    }).length,
    categories: new Set(competitors.map((c) => c.category).filter(Boolean)).size,
  }), [competitors]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return competitors;
    return competitors.filter((c) =>
      [c.name, c.category, c.offer, c.target_audience].some((v) => (v ?? "").toLowerCase().includes(needle)));
  }, [competitors, q]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg">Competitors</h1>
          <p className="max-w-3xl text-sm text-muted">
            Who else is doing this, where they are strong, where they are not — and what we are
            doing about it.
          </p>
        </div>
        <button onClick={() => setCreating(true)} className="shrink-0 rounded-full bg-brand px-4 py-2 text-sm font-medium text-white">
          + Track a competitor
        </button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Tracked" value={String(stats.total)} sub={`across ${stats.categories} categories`} />
        <KpiCard label="No response decided" value={String(stats.unanswered)}
          tone={stats.unanswered ? "warn" : "good"} />
        <KpiCard label="Overdue a review" value={String(stats.stale)} tone={stats.stale ? "warn" : "good"} />
        <KpiCard label="Answered" value={String(stats.total - stats.unanswered)} tone="good" />
      </div>

      <input value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="Name, category, offer or audience…"
        className="mb-3 w-full max-w-sm rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-fg outline-none focus:border-brand" />

      {shown.length === 0 ? (
        <EmptyState title="Nobody tracked yet" hint="Start with the two or three people a prospective member would compare us against." />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {shown.map((c) => {
            const d = daysUntil(c.review_date);
            const answered = !!c.our_response?.trim();
            return (
              <Card key={c.id} className="!p-0">
                <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
                  <div className="min-w-0">
                    <button onClick={() => setEditing(c)} className="font-medium text-fg hover:text-brand hover:underline">
                      {c.name}
                    </button>
                    <p className="text-xs text-muted">
                      {c.category || "Uncategorised"}
                      {c.business_model ? ` · ${c.business_model}` : ""}
                      {c.pricing ? ` · ${c.pricing}` : ""}
                    </p>
                  </div>
                  {d !== null && (
                    <span className={`shrink-0 text-[11px] ${d < 0 ? "font-semibold text-red-600" : "text-faint"}`}>
                      {d < 0 ? `review ${Math.abs(d)}d overdue` : `review ${shortDate(c.review_date!)}`}
                    </span>
                  )}
                </div>

                <div className="space-y-2.5 px-4 py-3">
                  {c.offer && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">What they offer</p>
                      <p className="text-xs text-fg">{c.offer}</p>
                    </div>
                  )}
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {c.strengths && (
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">Strong at</p>
                        <p className="text-xs text-fg">{c.strengths}</p>
                      </div>
                    )}
                    {c.gaps && (
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">Weak at</p>
                        <p className="text-xs text-fg">{c.gaps}</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className={`border-t px-4 py-3 ${answered ? "border-line bg-brand/5" : "border-amber-500/40 bg-amber-500/5"}`}>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">What we do about it</p>
                  {answered ? (
                    <p className="text-sm text-fg">{c.our_response}</p>
                  ) : (
                    <button onClick={() => setEditing(c)} className="text-sm text-amber-700 hover:underline">
                      Nothing decided yet — write it down
                    </button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <CompetitorForm open={creating || !!editing} competitor={editing}
        onClose={() => { setCreating(false); setEditing(null); }} />
    </>
  );
}

function CompetitorForm({
  open, competitor, onClose,
}: { open: boolean; competitor: Competitor | null; onClose: () => void }) {
  const [saving, start] = useTransition();
  const [form, setForm] = useState(() => ({
    name: competitor?.name ?? "", category: competitor?.category ?? "",
    offer: competitor?.offer ?? "", business_model: competitor?.business_model ?? "",
    pricing: competitor?.pricing ?? "", target_audience: competitor?.target_audience ?? "",
    strengths: competitor?.strengths ?? "", gaps: competitor?.gaps ?? "",
    our_response: competitor?.our_response ?? "",
    review_date: competitor?.review_date?.slice(0, 10) ?? "",
  }));
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal open={open} onClose={onClose} title={competitor ? `Edit ${competitor.name}` : "Track a competitor"} wide>
      <form onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await saveCompetitor(competitor?.id ?? null, form);
          if ("error" in res && res.error) toast(res.error, "error");
          else { toast("Saved", "success"); onClose(); }
        });
      }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><Input value={form.name} onChange={(e) => set("name", e.target.value)} required /></Field>
          <Field label="Category"><Input value={form.category} onChange={(e) => set("category", e.target.value)} /></Field>
          <div className="sm:col-span-2">
            <Field label="What they offer"><Textarea rows={2} value={form.offer} onChange={(e) => set("offer", e.target.value)} /></Field>
          </div>
          <Field label="Business model"><Input value={form.business_model} onChange={(e) => set("business_model", e.target.value)} /></Field>
          <Field label="Pricing"><Input value={form.pricing} onChange={(e) => set("pricing", e.target.value)} /></Field>
          <div className="sm:col-span-2">
            <Field label="Who they are for"><Input value={form.target_audience} onChange={(e) => set("target_audience", e.target.value)} /></Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Where they are strong"><Textarea rows={2} value={form.strengths} onChange={(e) => set("strengths", e.target.value)} /></Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Where they are weak"><Textarea rows={2} value={form.gaps} onChange={(e) => set("gaps", e.target.value)} /></Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="What we do about it — the part that matters">
              <Textarea rows={3} value={form.our_response} onChange={(e) => set("our_response", e.target.value)}
                placeholder="Lean harder on in-person events, which they cannot run remotely." />
            </Field>
          </div>
          <Field label="Review again on"><Input type="date" value={form.review_date} onChange={(e) => set("review_date", e.target.value)} /></Field>
        </div>
        <FormActions onCancel={onClose} saving={saving} submitLabel="Save" />
      </form>
    </Modal>
  );
}
