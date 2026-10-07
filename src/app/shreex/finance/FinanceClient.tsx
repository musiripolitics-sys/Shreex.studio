"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "@/components/Toast";
import { Modal, Field, Input, Textarea, Select, FormActions } from "@/components/os/Modal";
import { Card, KpiCard, EmptyState, SectionHeading } from "@/components/os/ui";
import { MoneyFlow, CumulativeNet, Breakdown, FlowTable, type FlowPoint, type Slice } from "./FinanceCharts";
import { inr, inrCompact, shortDate, rupeesToPaise, paiseToRupees } from "@/lib/bos";
import { saveExpense, deleteExpense, saveRevenue, deleteRevenue, saveCashflow } from "../actions";
import {
  type Expense,
  type RevenueEntry,
  type CashflowMonth,
  EXPENSE_CATEGORIES,
  REVENUE_SOURCES,
} from "./types";
import type { Workstream } from "../roadmap/types";

type Tab = "overview" | "expenses" | "revenue" | "cashflow";
const monthKey = (iso: string) => iso.slice(0, 7);
const curMonth = () => new Date().toISOString().slice(0, 7);

export function FinanceClient({
  expenses,
  revenue,
  cashflow,
  payments,
  workstreams,
  events,
}: {
  expenses: Expense[];
  revenue: RevenueEntry[];
  cashflow: CashflowMonth[];
  payments: { amount: number; stream: string; created_at: string }[];
  workstreams: Workstream[];
  events: { id: string; title: string }[];
}) {
  const [tab, setTab] = useState<Tab>("overview");

  // ── Aggregates (all money in paise) ──
  const agg = useMemo(() => {
    const revByMonth = new Map<string, number>();
    const expByMonth = new Map<string, number>();
    const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

    for (const r of revenue) add(revByMonth, monthKey(r.received_on), r.amount);
    for (const p of payments) add(revByMonth, monthKey(p.created_at), p.amount);
    for (const e of expenses) add(expByMonth, monthKey(e.spent_on), e.amount);

    const months = [...new Set([...revByMonth.keys(), ...expByMonth.keys()])].sort();
    const cm = curMonth();
    const totalRev = [...revByMonth.values()].reduce((a, b) => a + b, 0);
    const totalExp = [...expByMonth.values()].reduce((a, b) => a + b, 0);

    // Trailing 3 months burn = average positive (expense − revenue).
    const last3 = months.slice(-3);
    const burns = last3
      .map((m) => (expByMonth.get(m) ?? 0) - (revByMonth.get(m) ?? 0))
      .filter((n) => n > 0);
    const burn = burns.length ? burns.reduce((a, b) => a + b, 0) / burns.length : 0;

    // Projected closing cash from latest base cash-flow row.
    const base = cashflow.filter((c) => c.scenario === "base").sort((a, b) => a.month.localeCompare(b.month));
    const latest = base[base.length - 1];
    const closing = latest
      ? latest.opening_cash +
        latest.revenue_forecast -
        (latest.marketing_spend + latest.event_cost + latest.payroll + latest.hiring_cost + latest.technology_cost + latest.other_expenses)
      : 0;
    const runway = burn > 0 ? closing / burn : 0;

    return {
      revByMonth,
      expByMonth,
      months,
      monthRev: revByMonth.get(cm) ?? 0,
      monthExp: expByMonth.get(cm) ?? 0,
      totalRev,
      totalExp,
      burn,
      closing,
      runway,
    };
  }, [expenses, revenue, payments, cashflow]);

  const flow: FlowPoint[] = useMemo(
    () => agg.months.map((m) => ({
      month: m,
      inAmt: agg.revByMonth.get(m) ?? 0,
      outAmt: agg.expByMonth.get(m) ?? 0,
    })),
    [agg],
  );

  const spendByCategory: Slice[] = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of expenses) m.set(e.category || "Uncategorised", (m.get(e.category || "Uncategorised") ?? 0) + e.amount);
    return [...m].map(([label, value]) => ({ label, value }));
  }, [expenses]);

  const incomeBySource: Slice[] = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of revenue) m.set(r.source || "Other", (m.get(r.source || "Other") ?? 0) + r.amount);
    // Payments carry their own stream, and they are real income too.
    for (const p of payments) {
      const k = p.stream ? p.stream.replace(/_/g, " ") : "Payments";
      m.set(k, (m.get(k) ?? 0) + p.amount);
    }
    return [...m].map(([label, value]) => ({ label, value }));
  }, [revenue, payments]);

  // Research is consistent that runway is the number a small business acts on,
  // and that the thresholds are 12 / 6 / 3 months rather than a single line.
  const runwayTone = agg.burn <= 0 ? "good" : agg.runway >= 12 ? "good" : agg.runway >= 6 ? "default" : agg.runway >= 3 ? "warn" : "bad";

  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "expenses", label: "Expenses" },
    { key: "revenue", label: "Revenue" },
    { key: "cashflow", label: "Cash flow" },
  ];

  return (
    <>
      <div className="mb-4">
        <h1 className="font-display text-2xl font-bold tracking-tight text-fg">Financial Control Center</h1>
        <p className="text-sm text-muted">
          Revenue, expenses and cash flow — connected to live payments, events and campaigns.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
              tab === t.key ? "bg-brand text-white" : "border border-line bg-surface text-muted hover:text-fg"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <KpiCard label="Revenue (this month)" value={inrCompact(agg.monthRev)} sub={inr(agg.monthRev)} tone="good" />
            <KpiCard label="Expenses (this month)" value={inrCompact(agg.monthExp)} sub={inr(agg.monthExp)} tone="warn" />
            <KpiCard
              label="Profit (this month)"
              value={inrCompact(agg.monthRev - agg.monthExp)}
              tone={agg.monthRev - agg.monthExp >= 0 ? "good" : "bad"}
            />
            <KpiCard label="Monthly burn" value={inrCompact(agg.burn)} hint="Avg net outflow, 3 mo" tone="warn" />
            <KpiCard label="Cash position" value={inrCompact(agg.closing)} hint="Base forecast closing" />
            <KpiCard
              label="Runway"
              value={agg.burn > 0 ? `${agg.runway.toFixed(1)} mo` : "No burn"}
              tone={runwayTone}
              hint={agg.burn > 0 ? (agg.runway < 3 ? "Under 3 months" : agg.runway < 6 ? "Under 6 months" : undefined) : undefined}
            />
          </div>

          {agg.months.length === 0 ? (
            <EmptyState title="No financial data yet" hint="Log revenue and expenses and the flow appears here." />
          ) : (
            <>
              <SectionHeading
                title="Money in, money out"
                desc="Above the line arrived, below it left. The line through them is what was left over."
              />
              <Card className="mb-6">
                <MoneyFlow data={flow} />
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-muted hover:text-fg">
                    Show the numbers
                  </summary>
                  <div className="mt-2">
                    <FlowTable data={flow} />
                  </div>
                </details>
              </Card>

              <SectionHeading title="Where it has got to" desc="Every month of net, added up" />
              <Card className="mb-6">
                <CumulativeNet data={flow} />
              </Card>

              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <SectionHeading title="Where the money goes" desc="Spend by category" />
                  <Card><Breakdown rows={spendByCategory} hue="orange" /></Card>
                </div>
                <div>
                  <SectionHeading title="Where it comes from" desc="Income by source" />
                  <Card><Breakdown rows={incomeBySource} hue="blue" /></Card>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {tab === "expenses" && <ExpensesTab expenses={expenses} workstreams={workstreams} />}
      {tab === "revenue" && <RevenueTab revenue={revenue} workstreams={workstreams} events={events} />}
      {tab === "cashflow" && <CashflowTab cashflow={cashflow} />}
    </>
  );
}

// ─────────────────────────────── Expenses ───────────────────────────────

type ExpenseForm = {
  category: string;
  subcategory: string;
  description: string;
  amountRupees: string;
  spent_on: string;
  vendor: string;
  workstream_id: string;
  approval_status: "pending" | "approved" | "rejected";
  payment_status: "unpaid" | "paid";
  recurring: boolean;
};

const blankExpense: ExpenseForm = {
  category: "Marketing",
  subcategory: "",
  description: "",
  amountRupees: "",
  spent_on: new Date().toISOString().slice(0, 10),
  vendor: "",
  workstream_id: "",
  approval_status: "pending",
  payment_status: "unpaid",
  recurring: false,
};

function ExpensesTab({ expenses, workstreams }: { expenses: Expense[]; workstreams: Workstream[] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [form, setForm] = useState<ExpenseForm>({ ...blankExpense });
  const [fCat, setFCat] = useState("");
  const [pending, start] = useTransition();
  const wsMap = useMemo(() => Object.fromEntries(workstreams.map((w) => [w.id, w])), [workstreams]);

  const rows = expenses.filter((e) => !fCat || e.category === fCat);

  const openNew = () => { setEditing(null); setForm({ ...blankExpense }); setOpen(true); };
  const openEdit = (e: Expense) => {
    setEditing(e);
    setForm({
      category: e.category,
      subcategory: e.subcategory ?? "",
      description: e.description ?? "",
      amountRupees: paiseToRupees(e.amount).toString(),
      spent_on: e.spent_on,
      vendor: e.vendor ?? "",
      workstream_id: e.workstream_id ?? "",
      approval_status: e.approval_status,
      payment_status: e.payment_status,
      recurring: e.recurring,
    });
    setOpen(true);
  };

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const payload = {
      category: form.category,
      subcategory: form.subcategory || null,
      description: form.description || null,
      amount: rupeesToPaise(Number(form.amountRupees || 0)),
      spent_on: form.spent_on,
      vendor: form.vendor || null,
      workstream_id: form.workstream_id || null,
      approval_status: form.approval_status,
      payment_status: form.payment_status,
      recurring: form.recurring,
    };
    start(async () => {
      const res = await saveExpense(editing?.id ?? null, payload);
      if (res?.error) toast(res.error, "error");
      else { toast(editing ? "Expense updated" : "Expense added", "success"); setOpen(false); }
    });
  };

  const remove = (e: Expense) => {
    if (!confirm("Delete this expense?")) return;
    start(async () => {
      const res = await deleteExpense(e.id);
      if (res?.error) toast(res.error, "error");
      else toast("Expense deleted", "success");
    });
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <select value={fCat} onChange={(e) => setFCat(e.target.value)} className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-fg">
          <option value="">All categories</option>
          {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button onClick={openNew} className="rounded-full bg-brand px-4 py-2 text-sm font-medium text-white">+ Add expense</button>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No expenses yet" hint="Log your first expense to start tracking spend." />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-faint">
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-3 py-3 font-semibold">Category</th>
                <th className="px-3 py-3 font-semibold">Description</th>
                <th className="px-3 py-3 font-semibold">Vendor</th>
                <th className="px-3 py-3 font-semibold">Status</th>
                <th className="px-3 py-3 text-right font-semibold">Amount</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="border-b border-line/60 last:border-0 hover:bg-surface-2">
                  <td className="px-4 py-3 text-xs text-muted">{shortDate(e.spent_on)}</td>
                  <td className="px-3 py-3">
                    <span className="text-fg">{e.category}</span>
                    {e.subcategory && <span className="text-xs text-muted"> · {e.subcategory}</span>}
                    {e.recurring && <span className="ml-1 rounded-full bg-blue-100 px-1.5 text-[10px] text-blue-700">recurring</span>}
                    {e.workstream_id && wsMap[e.workstream_id] && (
                      <span className="ml-1 text-[11px] text-faint">({wsMap[e.workstream_id].name})</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-muted">{e.description || "—"}</td>
                  <td className="px-3 py-3 text-muted">{e.vendor || "—"}</td>
                  <td className="px-3 py-3 text-xs">
                    <span className={e.payment_status === "paid" ? "text-green-600" : "text-amber-600"}>{e.payment_status}</span>
                    <span className="text-faint"> · {e.approval_status}</span>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-medium text-fg">{inr(e.amount)}</td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    <button onClick={() => openEdit(e)} className="text-xs font-medium text-brand-soft hover:underline">Edit</button>
                    <button onClick={() => remove(e)} className="ml-3 text-xs font-medium text-red-600 hover:underline">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Edit expense" : "Add expense"} wide>
        <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Category *">
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Subcategory">
            <Input value={form.subcategory} onChange={(e) => setForm({ ...form, subcategory: e.target.value })} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description">
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
          </div>
          <Field label="Amount (₹) *">
            <Input type="number" min={0} step="0.01" required value={form.amountRupees} onChange={(e) => setForm({ ...form, amountRupees: e.target.value })} />
          </Field>
          <Field label="Date *">
            <Input type="date" required value={form.spent_on} onChange={(e) => setForm({ ...form, spent_on: e.target.value })} />
          </Field>
          <Field label="Vendor">
            <Input value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
          </Field>
          <Field label="Workstream">
            <Select value={form.workstream_id} onChange={(e) => setForm({ ...form, workstream_id: e.target.value })}>
              <option value="">—</option>
              {workstreams.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </Field>
          <Field label="Approval">
            <Select value={form.approval_status} onChange={(e) => setForm({ ...form, approval_status: e.target.value as typeof form.approval_status })}>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </Select>
          </Field>
          <Field label="Payment">
            <Select value={form.payment_status} onChange={(e) => setForm({ ...form, payment_status: e.target.value as typeof form.payment_status })}>
              <option value="unpaid">Unpaid</option>
              <option value="paid">Paid</option>
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-sm text-muted sm:col-span-2">
            <input type="checkbox" checked={form.recurring} onChange={(e) => setForm({ ...form, recurring: e.target.checked })} />
            Recurring cost
          </label>
          <div className="sm:col-span-2">
            <FormActions onCancel={() => setOpen(false)} saving={pending} submitLabel={editing ? "Save changes" : "Add expense"} />
          </div>
        </form>
      </Modal>
    </>
  );
}

// ─────────────────────────────── Revenue ───────────────────────────────

function RevenueTab({
  revenue,
  workstreams,
  events,
}: {
  revenue: RevenueEntry[];
  workstreams: Workstream[];
  events: { id: string; title: string }[];
}) {
  const blank = {
    source: "service",
    description: "",
    amountRupees: "",
    received_on: new Date().toISOString().slice(0, 10),
    related_event_id: "",
    workstream_id: "",
  };
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RevenueEntry | null>(null);
  const [form, setForm] = useState({ ...blank });
  const [pending, start] = useTransition();

  const openNew = () => { setEditing(null); setForm({ ...blank }); setOpen(true); };
  const openEdit = (r: RevenueEntry) => {
    setEditing(r);
    setForm({
      source: r.source,
      description: r.description ?? "",
      amountRupees: paiseToRupees(r.amount).toString(),
      received_on: r.received_on,
      related_event_id: r.related_event_id ?? "",
      workstream_id: r.workstream_id ?? "",
    });
    setOpen(true);
  };

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const payload = {
      source: form.source,
      description: form.description || null,
      amount: rupeesToPaise(Number(form.amountRupees || 0)),
      received_on: form.received_on,
      related_event_id: form.related_event_id || null,
      workstream_id: form.workstream_id || null,
    };
    start(async () => {
      const res = await saveRevenue(editing?.id ?? null, payload);
      if (res?.error) toast(res.error, "error");
      else { toast(editing ? "Revenue updated" : "Revenue added", "success"); setOpen(false); }
    });
  };

  const remove = (r: RevenueEntry) => {
    if (!confirm("Delete this revenue entry?")) return;
    start(async () => {
      const res = await deleteRevenue(r.id);
      if (res?.error) toast(res.error, "error");
      else toast("Revenue deleted", "success");
    });
  };

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-xs text-muted">Manual / offline revenue. Razorpay & membership income is already counted automatically.</p>
        <button onClick={openNew} className="rounded-full bg-brand px-4 py-2 text-sm font-medium text-white">+ Add revenue</button>
      </div>

      {revenue.length === 0 ? (
        <EmptyState title="No manual revenue logged" hint="Ticket & membership payments are still counted on the dashboard." />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-faint">
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-3 py-3 font-semibold">Source</th>
                <th className="px-3 py-3 font-semibold">Description</th>
                <th className="px-3 py-3 text-right font-semibold">Amount</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {revenue.map((r) => (
                <tr key={r.id} className="border-b border-line/60 last:border-0 hover:bg-surface-2">
                  <td className="px-4 py-3 text-xs text-muted">{shortDate(r.received_on)}</td>
                  <td className="px-3 py-3 capitalize text-fg">{r.source}</td>
                  <td className="px-3 py-3 text-muted">{r.description || "—"}</td>
                  <td className="px-3 py-3 text-right tabular-nums font-medium text-green-600">{inr(r.amount)}</td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    <button onClick={() => openEdit(r)} className="text-xs font-medium text-brand-soft hover:underline">Edit</button>
                    <button onClick={() => remove(r)} className="ml-3 text-xs font-medium text-red-600 hover:underline">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Edit revenue" : "Add revenue"}>
        <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Source *">
            <Select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
              {REVENUE_SOURCES.map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}
            </Select>
          </Field>
          <Field label="Amount (₹) *">
            <Input type="number" min={0} step="0.01" required value={form.amountRupees} onChange={(e) => setForm({ ...form, amountRupees: e.target.value })} />
          </Field>
          <Field label="Date *">
            <Input type="date" required value={form.received_on} onChange={(e) => setForm({ ...form, received_on: e.target.value })} />
          </Field>
          <Field label="Related event">
            <Select value={form.related_event_id} onChange={(e) => setForm({ ...form, related_event_id: e.target.value })}>
              <option value="">—</option>
              {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
            </Select>
          </Field>
          <Field label="Workstream">
            <Select value={form.workstream_id} onChange={(e) => setForm({ ...form, workstream_id: e.target.value })}>
              <option value="">—</option>
              {workstreams.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description">
              <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <FormActions onCancel={() => setOpen(false)} saving={pending} submitLabel={editing ? "Save changes" : "Add revenue"} />
          </div>
        </form>
      </Modal>
    </>
  );
}

// ─────────────────────────────── Cash flow ───────────────────────────────

function CashflowTab({ cashflow }: { cashflow: CashflowMonth[] }) {
  const blank = {
    month: `${curMonth()}-01`,
    scenario: "base" as const,
    opening: "",
    revenue: "",
    marketing: "",
    events: "",
    payroll: "",
    hiring: "",
    tech: "",
    other: "",
  };
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...blank });
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      month: form.month,
      scenario: form.scenario,
      opening_cash: rupeesToPaise(Number(form.opening || 0)),
      revenue_forecast: rupeesToPaise(Number(form.revenue || 0)),
      marketing_spend: rupeesToPaise(Number(form.marketing || 0)),
      event_cost: rupeesToPaise(Number(form.events || 0)),
      payroll: rupeesToPaise(Number(form.payroll || 0)),
      hiring_cost: rupeesToPaise(Number(form.hiring || 0)),
      technology_cost: rupeesToPaise(Number(form.tech || 0)),
      other_expenses: rupeesToPaise(Number(form.other || 0)),
    };
    start(async () => {
      const res = await saveCashflow(payload);
      if (res?.error) toast(res.error, "error");
      else { toast("Cash-flow month saved", "success"); setOpen(false); }
    });
  };

  const outflow = (c: CashflowMonth) =>
    c.marketing_spend + c.event_cost + c.payroll + c.hiring_cost + c.technology_cost + c.other_expenses;

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-xs text-muted">Monthly forecast by scenario. Net = revenue − all costs; closing = opening + net.</p>
        <button onClick={() => { setForm({ ...blank }); setOpen(true); }} className="rounded-full bg-brand px-4 py-2 text-sm font-medium text-white">
          + Add / update month
        </button>
      </div>

      {cashflow.length === 0 ? (
        <EmptyState title="No cash-flow forecast yet" hint="Add a month to project burn, runway and closing cash." />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-faint">
                <th className="px-4 py-3 font-semibold">Month</th>
                <th className="px-3 py-3 font-semibold">Scenario</th>
                <th className="px-3 py-3 text-right font-semibold">Opening</th>
                <th className="px-3 py-3 text-right font-semibold">Revenue</th>
                <th className="px-3 py-3 text-right font-semibold">Outflow</th>
                <th className="px-3 py-3 text-right font-semibold">Net</th>
                <th className="px-3 py-3 text-right font-semibold">Closing</th>
              </tr>
            </thead>
            <tbody>
              {cashflow.map((c) => {
                const net = c.revenue_forecast - outflow(c);
                return (
                  <tr key={c.id} className="border-b border-line/60 last:border-0">
                    <td className="px-4 py-3 font-medium text-fg">{c.month.slice(0, 7)}</td>
                    <td className="px-3 py-3 capitalize text-muted">{c.scenario}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted">{inr(c.opening_cash)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-green-600">{inr(c.revenue_forecast)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-amber-600">{inr(outflow(c))}</td>
                    <td className={`px-3 py-3 text-right tabular-nums ${net >= 0 ? "text-green-600" : "text-red-600"}`}>{inr(net)}</td>
                    <td className="px-3 py-3 text-right tabular-nums font-medium text-fg">{inr(c.opening_cash + net)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Cash-flow month" wide>
        <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Month *">
            <Input type="date" required value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })} />
          </Field>
          <Field label="Scenario">
            <Select value={form.scenario} onChange={(e) => setForm({ ...form, scenario: e.target.value as typeof form.scenario })}>
              <option value="base">Base</option>
              <option value="conservative">Conservative</option>
              <option value="growth">Growth</option>
            </Select>
          </Field>
          {([
            ["opening", "Opening cash (₹)"],
            ["revenue", "Revenue forecast (₹)"],
            ["marketing", "Marketing spend (₹)"],
            ["events", "Event cost (₹)"],
            ["payroll", "Payroll (₹)"],
            ["hiring", "Hiring cost (₹)"],
            ["tech", "Technology cost (₹)"],
            ["other", "Other expenses (₹)"],
          ] as const).map(([k, label]) => (
            <Field key={k} label={label}>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form[k]}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              />
            </Field>
          ))}
          <div className="sm:col-span-2">
            <FormActions onCancel={() => setOpen(false)} saving={pending} submitLabel="Save month" />
          </div>
        </form>
      </Modal>
    </>
  );
}
