"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "@/components/Toast";
import { Card, KpiCard, EmptyState, SectionHeading } from "@/components/os/ui";
import { Modal, Field, Input, Select, Textarea, FormActions } from "@/components/os/Modal";
import { inr, inrCompact, shortDate, rupeesToPaise, paiseToRupees } from "@/lib/bos";
import { Breakdown } from "../finance/FinanceCharts";
import { saveVendor, setVendorStatus } from "./actions";

export type Vendor = {
  id: string; name: string; category: string | null; contact: string | null;
  service: string | null; contract: string | null;
  start_date: string | null; end_date: string | null;
  monthly_cost: number; status: string | null;
  owner_id: string | null; performance: number | null;
};

type Person = { id: string; full_name: string | null; email: string | null };

const STATUSES = ["active", "trial", "paused", "ended"];

const STATUS_TONE: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  trial: "bg-blue-100 text-blue-700",
  paused: "bg-amber-100 text-amber-700",
  ended: "bg-surface-2 text-faint",
};

const daysUntil = (d: string | null) =>
  d ? Math.ceil((new Date(d).getTime() - Date.now()) / 86400000) : null;

/**
 * Vendors, arranged around the two questions anybody actually opens this for:
 * what are we committed to every month, and what is about to renew without
 * anyone deciding to renew it.
 *
 * A renewal date buried in a table column is a renewal nobody sees. It is the
 * first thing on the page instead.
 */
export function VendorsClient({
  vendors, expenses, people,
}: {
  vendors: Vendor[];
  expenses: { vendor: string | null; amount: number; spent_on: string }[];
  people: Person[];
}) {
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("live");
  const [saving, start] = useTransition();

  const nameOf = (id: string | null) => people.find((p) => p.id === id)?.full_name ?? "—";

  // What each vendor has actually cost, matched on the free-text vendor field.
  const paidTo = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of expenses) {
      if (!e.vendor) continue;
      const k = e.vendor.trim().toLowerCase();
      m.set(k, (m.get(k) ?? 0) + e.amount);
    }
    return m;
  }, [expenses]);

  const stats = useMemo(() => {
    const live = vendors.filter((v) => v.status !== "ended");
    const committed = live.reduce((a, v) => a + (v.monthly_cost ?? 0), 0);
    const renewing = live.filter((v) => {
      const d = daysUntil(v.end_date);
      return d !== null && d <= 60;
    });
    const unowned = live.filter((v) => !v.owner_id).length;
    return { live: live.length, committed, renewing, unowned };
  }, [vendors]);

  const spendByCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of vendors) {
      if (v.status === "ended") continue;
      const k = v.category || "Uncategorised";
      m.set(k, (m.get(k) ?? 0) + (v.monthly_cost ?? 0));
    }
    return [...m].map(([label, value]) => ({ label, value })).filter((r) => r.value > 0);
  }, [vendors]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return vendors.filter((v) => {
      if (status === "live" && v.status === "ended") return false;
      if (status !== "live" && status !== "all" && v.status !== status) return false;
      if (!needle) return true;
      return [v.name, v.category, v.service, v.contact].some((x) => (x ?? "").toLowerCase().includes(needle));
    });
  }, [vendors, q, status]);

  const move = (v: Vendor, s: string) =>
    start(async () => {
      const res = await setVendorStatus(v.id, s);
      if ("error" in res && res.error) toast(res.error, "error");
      else toast(`${v.name} is now ${s}`, "success");
    });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg">Vendors</h1>
          <p className="max-w-3xl text-sm text-muted">
            What we pay every month, who owns each relationship, and what renews next.
          </p>
        </div>
        <button onClick={() => setCreating(true)} className="shrink-0 rounded-full bg-brand px-4 py-2 text-sm font-medium text-white">
          + Add a vendor
        </button>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Committed monthly" value={inrCompact(stats.committed)} sub={inr(stats.committed)} />
        <KpiCard label="A year of it" value={inrCompact(stats.committed * 12)} hint="At today's rates" />
        <KpiCard label="Renewing within 60 days" value={String(stats.renewing.length)}
          tone={stats.renewing.length ? "warn" : "good"} />
        <KpiCard label="Nobody owns them" value={String(stats.unowned)} tone={stats.unowned ? "warn" : "good"} />
      </div>

      {/* ── What renews next, because that is the thing that gets missed ── */}
      {stats.renewing.length > 0 && (
        <Card className="mb-5 border-amber-500/40">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
            Coming up for renewal
          </p>
          <ul className="divide-y divide-line">
            {stats.renewing
              .sort((a, b) => (a.end_date ?? "").localeCompare(b.end_date ?? ""))
              .map((v) => {
                const d = daysUntil(v.end_date)!;
                return (
                  <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <button onClick={() => setEditing(v)} className="text-sm font-medium text-fg hover:text-brand hover:underline">
                        {v.name}
                      </button>
                      <p className="text-xs text-muted">
                        {inr(v.monthly_cost)}/mo · owned by {nameOf(v.owner_id)}
                      </p>
                    </div>
                    <span className={`shrink-0 text-xs font-semibold ${d < 0 ? "text-red-600" : d <= 14 ? "text-amber-600" : "text-muted"}`}>
                      {d < 0 ? `expired ${Math.abs(d)}d ago` : d === 0 ? "expires today" : `${d} days`}
                    </span>
                  </li>
                );
              })}
          </ul>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, category or service…"
              className="w-56 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-fg outline-none focus:border-brand" />
            {["live", ...STATUSES, "all"].map((s) => (
              <button key={s} onClick={() => setStatus(s)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${
                  status === s ? "bg-brand text-white" : "border border-line text-muted hover:text-fg"}`}>
                {s}
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <EmptyState title="No vendors here" hint="Add the services you pay for — hosting, email, venue, design." />
          ) : (
            <ul className="space-y-2">
              {shown.map((v) => {
                const paid = paidTo.get(v.name.trim().toLowerCase()) ?? 0;
                const d = daysUntil(v.end_date);
                return (
                  <li key={v.id}>
                    <Card className="!p-0">
                      <div className="flex flex-wrap items-start gap-3 p-3.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <button onClick={() => setEditing(v)} className="font-medium text-fg hover:text-brand hover:underline">
                              {v.name}
                            </button>
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[v.status ?? ""] ?? "bg-surface-2 text-muted"}`}>
                              {v.status ?? "unknown"}
                            </span>
                            {v.category && <span className="text-[11px] text-faint">{v.category}</span>}
                          </div>
                          <p className="mt-0.5 text-xs text-muted">
                            {v.service || "No service recorded"}
                            {v.contact ? ` · ${v.contact}` : ""}
                          </p>
                          <p className="mt-1 text-[11px] text-faint">
                            Owner {nameOf(v.owner_id)}
                            {v.start_date ? ` · since ${shortDate(v.start_date)}` : ""}
                            {d !== null ? ` · ${d < 0 ? "expired" : `renews in ${d}d`}` : " · no end date"}
                          </p>
                        </div>

                        <div className="shrink-0 text-right">
                          <p className="font-display text-base font-bold tabular-nums text-fg">
                            {v.monthly_cost ? `${inrCompact(v.monthly_cost)}/mo` : "—"}
                          </p>
                          {paid > 0 && (
                            <p className="text-[11px] text-faint">{inr(paid)} paid to date</p>
                          )}
                          {v.performance != null && (
                            <p className="text-[11px] text-muted">{"★".repeat(v.performance)}{"☆".repeat(5 - v.performance)}</p>
                          )}
                        </div>

                        <div className="flex shrink-0 gap-1">
                          {v.status !== "ended" ? (
                            <button disabled={saving} onClick={() => move(v, "ended")}
                              className="rounded-full border border-line px-2.5 py-1 text-[11px] font-medium text-muted hover:text-fg disabled:opacity-40">
                              End
                            </button>
                          ) : (
                            <button disabled={saving} onClick={() => move(v, "active")}
                              className="rounded-full border border-line px-2.5 py-1 text-[11px] font-medium text-muted hover:text-fg disabled:opacity-40">
                              Reopen
                            </button>
                          )}
                        </div>
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div>
          <SectionHeading title="Monthly commitment" desc="By category, at today's rates" />
          <Card><Breakdown rows={spendByCategory} hue="orange" /></Card>
        </div>
      </div>

      <VendorForm open={creating || !!editing} vendor={editing} people={people}
        onClose={() => { setCreating(false); setEditing(null); }} />
    </>
  );
}

function VendorForm({
  open, vendor, people, onClose,
}: { open: boolean; vendor: Vendor | null; people: Person[]; onClose: () => void }) {
  const [saving, start] = useTransition();
  const [form, setForm] = useState(() => ({
    name: vendor?.name ?? "", category: vendor?.category ?? "",
    service: vendor?.service ?? "", contact: vendor?.contact ?? "",
    contract: vendor?.contract ?? "",
    costRupees: vendor?.monthly_cost ? String(paiseToRupees(vendor.monthly_cost)) : "",
    start_date: vendor?.start_date?.slice(0, 10) ?? "",
    end_date: vendor?.end_date?.slice(0, 10) ?? "",
    status: vendor?.status ?? "active",
    performance: vendor?.performance != null ? String(vendor.performance) : "",
    owner_id: vendor?.owner_id ?? "",
  }));
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal open={open} onClose={onClose} title={vendor ? "Edit vendor" : "Add a vendor"} wide>
      <form onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await saveVendor(vendor?.id ?? null, {
            ...form,
            monthly_cost: rupeesToPaise(Number(form.costRupees) || 0),
            performance: form.performance === "" ? null : form.performance,
          });
          if ("error" in res && res.error) toast(res.error, "error");
          else { toast("Saved", "success"); onClose(); }
        });
      }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Vendor"><Input value={form.name} onChange={(e) => set("name", e.target.value)} required /></Field>
          </div>
          <Field label="Category"><Input value={form.category} onChange={(e) => set("category", e.target.value)} placeholder="Hosting" /></Field>
          <Field label="What they do for us"><Input value={form.service} onChange={(e) => set("service", e.target.value)} /></Field>
          <Field label="Monthly cost (₹)">
            <Input type="number" min={0} value={form.costRupees} onChange={(e) => set("costRupees", e.target.value)} />
          </Field>
          <Field label="Who owns the relationship">
            <Select value={form.owner_id} onChange={(e) => set("owner_id", e.target.value)}>
              <option value="">Nobody</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
            </Select>
          </Field>
          <Field label="Started"><Input type="date" value={form.start_date} onChange={(e) => set("start_date", e.target.value)} /></Field>
          <Field label="Renews or ends">
            <Input type="date" value={form.end_date} onChange={(e) => set("end_date", e.target.value)} />
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(e) => set("status", e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="How they are doing">
            <Select value={form.performance} onChange={(e) => set("performance", e.target.value)}>
              <option value="">Not rated</option>
              {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{"★".repeat(n)}</option>)}
            </Select>
          </Field>
          <Field label="Contact"><Input value={form.contact} onChange={(e) => set("contact", e.target.value)} placeholder="name@vendor.com" /></Field>
          <div className="sm:col-span-2">
            <Field label="Contract notes"><Textarea rows={2} value={form.contract} onChange={(e) => set("contract", e.target.value)} /></Field>
          </div>
        </div>
        <p className="mt-2 text-xs text-faint">
          An end date is what puts a vendor in the renewal list. Without one, nothing will warn you
          before it rolls over.
        </p>
        <FormActions onCancel={onClose} saving={saving} submitLabel="Save" />
      </form>
    </Modal>
  );
}
