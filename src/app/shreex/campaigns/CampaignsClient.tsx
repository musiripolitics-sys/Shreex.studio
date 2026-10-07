"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "@/components/Toast";
import { Card, KpiCard, EmptyState } from "@/components/os/ui";
import { Modal, Field, Input, Select, Textarea, FormActions } from "@/components/os/Modal";
import { inr, inrCompact, num, shortDate, rupeesToPaise, paiseToRupees } from "@/lib/bos";
import { saveCampaign } from "@/lib/marketing-actions";

export type Campaign = {
  id: string; code: string | null; name: string; channel: string | null;
  campaign_type: string | null; objective: string | null; audience: string | null;
  owner_id: string | null; start_date: string | null; end_date: string | null;
  budget: number; actual_spend: number;
  target_reach: number; actual_reach: number;
  target_leads: number; actual_leads: number;
  target_conversions: number; actual_conversions: number;
  revenue_generated: number; status: string;
};

type Person = { id: string; full_name: string | null; email: string | null };
type Content = { id: string; campaign_id: string | null; status: string; reach: number | null; leads: number | null };

const STATUS_TONE: Record<string, string> = {
  not_started: "bg-surface-2 text-muted",
  in_progress: "bg-blue-100 text-blue-700",
  blocked: "bg-red-100 text-red-700",
  completed: "bg-green-100 text-green-700",
  on_hold: "bg-amber-100 text-amber-700",
  cancelled: "bg-surface-2 text-faint",
};

/** A target with a result against it, as a bar you can read at a glance. */
function Against({ label, actual, target, format = num }:
  { label: string; actual: number; target: number; format?: (n: number) => string }) {
  const pct = target > 0 ? Math.min(150, (actual / target) * 100) : null;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[11px] text-faint">{label}</span>
        <span className="text-xs tabular-nums text-fg">
          {format(actual)}
          {target > 0 && <span className="text-faint"> / {format(target)}</span>}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        {pct != null && (
          <div className="h-full rounded-full transition-[width]"
            style={{ width: `${Math.max(2, pct)}%`, background: pct >= 100 ? "#1baf7a" : "#2a78d6" }} />
        )}
      </div>
    </div>
  );
}

/**
 * Campaigns, read as "did it do what it was for".
 *
 * Budget against spend and each target against its result, on one card, so
 * the question a campaign exists to answer is the thing you see first rather
 * than a row of numbers to compare by eye.
 */
export function CampaignsClient({
  campaigns, content, people,
}: { campaigns: Campaign[]; content: Content[]; people: Person[] }) {
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [creating, setCreating] = useState(false);

  const nameOf = (id: string | null) => people.find((p) => p.id === id)?.full_name ?? "—";

  const totals = useMemo(() => {
    const live = campaigns.filter((c) => c.status !== "cancelled");
    return {
      budget: live.reduce((a, c) => a + (c.budget ?? 0), 0),
      spend: live.reduce((a, c) => a + (c.actual_spend ?? 0), 0),
      leads: live.reduce((a, c) => a + (c.actual_leads ?? 0), 0),
      revenue: live.reduce((a, c) => a + (c.revenue_generated ?? 0), 0),
    };
  }, [campaigns]);

  const pieces = (id: string) => content.filter((c) => c.campaign_id === id);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg">Campaigns</h1>
          <p className="max-w-3xl text-sm text-muted">
            What we are spending, what it was meant to achieve, and what it actually did.
          </p>
        </div>
        <button onClick={() => setCreating(true)} className="shrink-0 rounded-full bg-brand px-4 py-2 text-sm font-medium text-white">
          + New campaign
        </button>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Committed budget" value={inrCompact(totals.budget)} sub={inr(totals.budget)} />
        <KpiCard label="Spent so far" value={inrCompact(totals.spend)}
          sub={totals.budget > 0 ? `${Math.round((totals.spend / totals.budget) * 100)}% of budget` : undefined}
          tone={totals.spend > totals.budget ? "bad" : "default"} />
        <KpiCard label="Leads" value={num(totals.leads)} />
        <KpiCard label="Revenue attributed" value={inrCompact(totals.revenue)}
          tone={totals.revenue > totals.spend ? "good" : "default"}
          sub={totals.spend > 0 ? `${(totals.revenue / totals.spend).toFixed(1)}× spend` : undefined} />
      </div>

      {campaigns.length === 0 ? (
        <EmptyState title="No campaigns yet" hint="A campaign gives a batch of content a budget and something to hit." />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {campaigns.map((c) => {
            const mine = pieces(c.id);
            const done = mine.filter((p) => p.status === "completed").length;
            const over = c.budget > 0 && c.actual_spend > c.budget;
            return (
              <Card key={c.id} className="!p-0">
                <div className="border-b border-line px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <button onClick={() => setEditing(c)} className="font-medium text-fg hover:text-brand hover:underline">
                          {c.code && <span className="mr-1.5 font-mono text-[11px] text-faint">{c.code}</span>}
                          {c.name}
                        </button>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[c.status] ?? ""}`}>
                          {c.status.replace("_", " ")}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted">{c.objective || "No objective recorded"}</p>
                      <p className="mt-0.5 text-[11px] text-faint">
                        {c.channel || "No channel"} · {nameOf(c.owner_id)}
                        {c.start_date ? ` · ${shortDate(c.start_date)}` : ""}
                        {c.end_date ? ` → ${shortDate(c.end_date)}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={`font-display text-base font-bold tabular-nums ${over ? "text-red-600" : "text-fg"}`}>
                        {inrCompact(c.actual_spend)}
                      </p>
                      <p className="text-[11px] text-faint">of {inrCompact(c.budget)}</p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 p-4 sm:grid-cols-2">
                  <Against label="Reach" actual={c.actual_reach} target={c.target_reach} />
                  <Against label="Leads" actual={c.actual_leads} target={c.target_leads} />
                  <Against label="Conversions" actual={c.actual_conversions} target={c.target_conversions} />
                  <Against label="Spend" actual={c.actual_spend} target={c.budget} format={inrCompact} />
                </div>

                <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2">
                  <Link href="/shreex/content" className="text-[11px] font-medium text-brand-soft hover:underline">
                    {mine.length > 0 ? `${done} of ${mine.length} pieces published →` : "No content attached yet →"}
                  </Link>
                  {c.revenue_generated > 0 && (
                    <span className="text-[11px] text-green-700">
                      {inr(c.revenue_generated)} attributed
                    </span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <CampaignForm open={creating || !!editing} campaign={editing} people={people}
        onClose={() => { setCreating(false); setEditing(null); }} />
    </>
  );
}

function CampaignForm({
  open, campaign, people, onClose,
}: { open: boolean; campaign: Campaign | null; people: Person[]; onClose: () => void }) {
  const [saving, start] = useTransition();
  const r = (n: number | undefined) => (n ? String(paiseToRupees(n)) : "");
  const [form, setForm] = useState(() => ({
    name: campaign?.name ?? "", code: campaign?.code ?? "",
    channel: campaign?.channel ?? "", campaign_type: campaign?.campaign_type ?? "",
    objective: campaign?.objective ?? "", audience: campaign?.audience ?? "",
    owner_id: campaign?.owner_id ?? "", status: campaign?.status ?? "not_started",
    start_date: campaign?.start_date?.slice(0, 10) ?? "", end_date: campaign?.end_date?.slice(0, 10) ?? "",
    budgetR: r(campaign?.budget), spendR: r(campaign?.actual_spend),
    target_reach: String(campaign?.target_reach ?? ""), actual_reach: String(campaign?.actual_reach ?? ""),
    target_leads: String(campaign?.target_leads ?? ""), actual_leads: String(campaign?.actual_leads ?? ""),
    target_conversions: String(campaign?.target_conversions ?? ""), actual_conversions: String(campaign?.actual_conversions ?? ""),
    revenueR: r(campaign?.revenue_generated),
  }));
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal open={open} onClose={onClose} title={campaign ? "Edit campaign" : "New campaign"} wide>
      <form onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await saveCampaign(campaign?.id ?? null, {
            ...form,
            budget: rupeesToPaise(Number(form.budgetR) || 0),
            actual_spend: rupeesToPaise(Number(form.spendR) || 0),
            revenue_generated: rupeesToPaise(Number(form.revenueR) || 0),
            target_reach: form.target_reach || 0, actual_reach: form.actual_reach || 0,
            target_leads: form.target_leads || 0, actual_leads: form.actual_leads || 0,
            target_conversions: form.target_conversions || 0, actual_conversions: form.actual_conversions || 0,
          });
          if ("error" in res && res.error) toast(res.error, "error");
          else { toast("Saved", "success"); onClose(); }
        });
      }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Campaign"><Input value={form.name} onChange={(e) => set("name", e.target.value)} required /></Field>
          </div>
          <Field label="Code"><Input value={form.code} onChange={(e) => set("code", e.target.value)} placeholder="C-001" /></Field>
          <Field label="Channel"><Input value={form.channel} onChange={(e) => set("channel", e.target.value)} placeholder="LinkedIn, Instagram" /></Field>
          <div className="sm:col-span-2">
            <Field label="What it is for"><Textarea rows={2} value={form.objective} onChange={(e) => set("objective", e.target.value)} /></Field>
          </div>
          <Field label="Owner">
            <Select value={form.owner_id} onChange={(e) => set("owner_id", e.target.value)}>
              <option value="">Nobody</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(e) => set("status", e.target.value)}>
              {["not_started","in_progress","blocked","completed","on_hold","cancelled"].map((s) =>
                <option key={s} value={s}>{s.replace("_"," ")}</option>)}
            </Select>
          </Field>
          <Field label="Runs from"><Input type="date" value={form.start_date} onChange={(e) => set("start_date", e.target.value)} /></Field>
          <Field label="Until"><Input type="date" value={form.end_date} onChange={(e) => set("end_date", e.target.value)} /></Field>

          <Field label="Budget (₹)"><Input type="number" min={0} value={form.budgetR} onChange={(e) => set("budgetR", e.target.value)} /></Field>
          <Field label="Spent (₹)"><Input type="number" min={0} value={form.spendR} onChange={(e) => set("spendR", e.target.value)} /></Field>
          <Field label="Target reach"><Input type="number" min={0} value={form.target_reach} onChange={(e) => set("target_reach", e.target.value)} /></Field>
          <Field label="Actual reach"><Input type="number" min={0} value={form.actual_reach} onChange={(e) => set("actual_reach", e.target.value)} /></Field>
          <Field label="Target leads"><Input type="number" min={0} value={form.target_leads} onChange={(e) => set("target_leads", e.target.value)} /></Field>
          <Field label="Actual leads"><Input type="number" min={0} value={form.actual_leads} onChange={(e) => set("actual_leads", e.target.value)} /></Field>
          <Field label="Target conversions"><Input type="number" min={0} value={form.target_conversions} onChange={(e) => set("target_conversions", e.target.value)} /></Field>
          <Field label="Actual conversions"><Input type="number" min={0} value={form.actual_conversions} onChange={(e) => set("actual_conversions", e.target.value)} /></Field>
          <div className="sm:col-span-2">
            <Field label="Revenue attributed (₹)"><Input type="number" min={0} value={form.revenueR} onChange={(e) => set("revenueR", e.target.value)} /></Field>
          </div>
        </div>
        <FormActions onCancel={onClose} saving={saving} submitLabel="Save" />
      </form>
    </Modal>
  );
}
