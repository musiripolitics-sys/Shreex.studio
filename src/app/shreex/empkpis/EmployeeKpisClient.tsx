"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "@/components/Toast";
import { Card, KpiCard, EmptyState } from "@/components/os/ui";
import { Modal, Field, Input, Select, FormActions } from "@/components/os/Modal";
import { saveEmployeeKpi, setKpiActual } from "@/lib/team-actions";

export type EmployeeKpi = {
  id: string; employee_id: string; kpi_name: string;
  period: string | null; target: number | null; actual: number | null;
};

type Person = { id: string; full_name: string | null; email: string | null };

const monthLabel = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { month: "long", year: "numeric" }) : "No period";

/**
 * Targets, and whether anybody wrote down what happened.
 *
 * Every KPI in this system had a target and no actual, which is what a
 * measure becomes when recording it means opening a form. So the number is
 * editable in place: type it, leave the field, done. The page leads with how
 * many are still blank, because that is the problem — not the scores.
 */
export function EmployeeKpisClient({ kpis, people }: { kpis: EmployeeKpi[]; people: Person[] }) {
  const [editing, setEditing] = useState<EmployeeKpi | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, start] = useTransition();
  const [period, setPeriod] = useState<string>("all");

  const nameOf = (id: string) => people.find((p) => p.id === id)?.full_name ?? "Unknown";

  const periods = useMemo(
    () => [...new Set(kpis.map((k) => k.period?.slice(0, 7)).filter(Boolean) as string[])].sort().reverse(),
    [kpis],
  );
  const shown = period === "all" ? kpis : kpis.filter((k) => k.period?.startsWith(period));

  const stats = useMemo(() => {
    const measured = shown.filter((k) => k.actual != null);
    const hit = measured.filter((k) => k.target != null && k.actual != null && k.actual >= k.target);
    return {
      total: shown.length,
      blank: shown.length - measured.length,
      hit: hit.length,
      measured: measured.length,
    };
  }, [shown]);

  const byPerson = useMemo(() => {
    const name = (id: string) => people.find((p) => p.id === id)?.full_name ?? "Unknown";
    const g = new Map<string, EmployeeKpi[]>();
    for (const k of shown) {
      if (!g.has(k.employee_id)) g.set(k.employee_id, []);
      g.get(k.employee_id)!.push(k);
    }
    return [...g.entries()].sort((a, b) => name(a[0]).localeCompare(name(b[0])));
  }, [shown, people]);

  const record = (k: EmployeeKpi, value: string) => {
    if (value === String(k.actual ?? "")) return;
    start(async () => {
      const res = await setKpiActual(k.id, value);
      if ("error" in res && res.error) toast(res.error, "error");
      else toast("Recorded", "success");
    });
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg">Employee KPIs</h1>
          <p className="max-w-3xl text-sm text-muted">
            What each person is measured on, and what actually happened. Type a number straight into
            the box — a target nobody records against is just a wish.
          </p>
        </div>
        <button onClick={() => setCreating(true)} className="shrink-0 rounded-full bg-brand px-4 py-2 text-sm font-medium text-white">
          + Set a KPI
        </button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="KPIs set" value={String(stats.total)} />
        <KpiCard label="Never recorded" value={String(stats.blank)} tone={stats.blank ? "warn" : "good"}
          sub={stats.blank ? "no actual entered" : "all recorded"} />
        <KpiCard label="Recorded" value={String(stats.measured)} />
        <KpiCard label="Target met" value={stats.measured ? `${stats.hit} of ${stats.measured}` : "—"}
          tone={stats.measured && stats.hit === stats.measured ? "good" : "default"} />
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <button onClick={() => setPeriod("all")}
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            period === "all" ? "bg-brand text-white" : "border border-line text-muted hover:text-fg"}`}>
          All periods
        </button>
        {periods.map((p) => (
          <button key={p} onClick={() => setPeriod(p)}
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              period === p ? "bg-brand text-white" : "border border-line text-muted hover:text-fg"}`}>
            {p}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState title="No KPIs set" hint="Give somebody one measure that matters and a number to hit." />
      ) : (
        <div className="space-y-4">
          {byPerson.map(([pid, list]) => (
            <Card key={pid} className="!p-0">
              <div className="border-b border-line px-4 py-2.5">
                <h2 className="text-sm font-semibold text-fg">{nameOf(pid)}</h2>
                <p className="text-[11px] text-faint">
                  {list.filter((k) => k.actual != null).length} of {list.length} recorded
                </p>
              </div>
              <div className="divide-y divide-line">
                {list.map((k) => {
                  const met = k.target != null && k.actual != null && k.actual >= k.target;
                  const missed = k.target != null && k.actual != null && k.actual < k.target;
                  return (
                    <div key={k.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <button onClick={() => setEditing(k)} className="text-sm text-fg hover:text-brand hover:underline">
                          {k.kpi_name}
                        </button>
                        <p className="text-[11px] text-faint">{monthLabel(k.period)}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {/* Uncontrolled on purpose: typing should not re-render
                            the row on every keystroke, and the write happens
                            when the field is left. */}
                        <input
                          type="number"
                          defaultValue={k.actual ?? ""}
                          disabled={saving}
                          placeholder="—"
                          onBlur={(e) => record(k, e.target.value)}
                          className={`w-24 rounded-lg border px-2.5 py-1.5 text-right text-sm tabular-nums outline-none focus:border-brand ${
                            met ? "border-green-500 bg-green-500/5 text-green-700"
                              : missed ? "border-amber-500 bg-amber-500/5 text-amber-700"
                              : "border-line bg-surface text-fg"}`}
                        />
                        <span className="w-20 text-xs tabular-nums text-faint">
                          of {k.target ?? "—"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>
      )}

      <KpiForm open={creating || !!editing} kpi={editing} people={people}
        onClose={() => { setCreating(false); setEditing(null); }} />
    </>
  );
}

function KpiForm({
  open, kpi, people, onClose,
}: { open: boolean; kpi: EmployeeKpi | null; people: Person[]; onClose: () => void }) {
  const [saving, start] = useTransition();
  const [form, setForm] = useState(() => ({
    employee_id: kpi?.employee_id ?? "", kpi_name: kpi?.kpi_name ?? "",
    period: kpi?.period?.slice(0, 10) ?? "",
    target: kpi?.target != null ? String(kpi.target) : "",
    actual: kpi?.actual != null ? String(kpi.actual) : "",
  }));
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal open={open} onClose={onClose} title={kpi ? "Edit KPI" : "Set a KPI"}>
      <form onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await saveEmployeeKpi(kpi?.id ?? null, {
            ...form,
            target: form.target === "" ? null : form.target,
            actual: form.actual === "" ? null : form.actual,
          });
          if ("error" in res && res.error) toast(res.error, "error");
          else { toast("Saved", "success"); onClose(); }
        });
      }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Who">
              <Select value={form.employee_id} onChange={(e) => set("employee_id", e.target.value)} required>
                <option value="">Choose someone</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
              </Select>
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="What is measured">
              <Input value={form.kpi_name} onChange={(e) => set("kpi_name", e.target.value)}
                placeholder="Tasks completed on time" required />
            </Field>
          </div>
          <Field label="Period"><Input type="date" value={form.period} onChange={(e) => set("period", e.target.value)} /></Field>
          <Field label="Target"><Input type="number" value={form.target} onChange={(e) => set("target", e.target.value)} /></Field>
          <Field label="Actual"><Input type="number" value={form.actual} onChange={(e) => set("actual", e.target.value)} /></Field>
        </div>
        <FormActions onCancel={onClose} saving={saving} submitLabel="Save" />
      </form>
    </Modal>
  );
}
