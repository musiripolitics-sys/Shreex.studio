"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "@/components/Toast";
import { Card, KpiCard, EmptyState } from "@/components/os/ui";
import { Modal, Field, Input, Select, Textarea, FormActions } from "@/components/os/Modal";
import { inr, inrCompact, shortDate, rupeesToPaise, paiseToRupees } from "@/lib/bos";
import { saveRole, setRoleStatus } from "@/lib/team-actions";

export type Role = {
  id: string; role: string; department: string | null; reason: string | null;
  expected_output: string | null; target_month: string | null; start_date: string | null;
  monthly_cost: number; one_time_cost: number; recruitment_budget: number;
  owner_id: string | null; status: string;
};

type Person = { id: string; full_name: string | null; email: string | null };

const STAGES = [
  { key: "not_started", label: "Planned" },
  { key: "in_progress", label: "Recruiting" },
  { key: "blocked", label: "On hold" },
  { key: "completed", label: "Hired" },
];

const monthLabel = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { month: "long", year: "numeric" }) : "No date set";

/**
 * The hiring plan, as a commitment rather than a list.
 *
 * A role is a decision to spend money from a month onwards, so the page is
 * ordered by when each one lands and totals what the plan costs once everyone
 * in it has started — the number that makes a hiring plan real.
 */
export function HiringClient({ roles, people }: { roles: Role[]; people: Person[] }) {
  const [editing, setEditing] = useState<Role | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, start] = useTransition();

  const nameOf = (id: string | null) => people.find((p) => p.id === id)?.full_name ?? "—";

  const stats = useMemo(() => {
    const open = roles.filter((r) => r.status !== "completed" && r.status !== "cancelled");
    return {
      open: open.length,
      hired: roles.filter((r) => r.status === "completed").length,
      runRate: open.reduce((a, r) => a + (r.monthly_cost ?? 0), 0),
      oneOff: open.reduce((a, r) => a + (r.one_time_cost ?? 0) + (r.recruitment_budget ?? 0), 0),
    };
  }, [roles]);

  // Grouped by the month they are meant to land, which is how a plan is read.
  const byMonth = useMemo(() => {
    const g = new Map<string, Role[]>();
    for (const r of roles) {
      const k = r.target_month?.slice(0, 7) ?? "zzz";
      if (!g.has(k)) g.set(k, []);
      g.get(k)!.push(r);
    }
    return [...g.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [roles]);

  const move = (r: Role, status: string) =>
    start(async () => {
      const res = await setRoleStatus(r.id, status);
      if ("error" in res && res.error) toast(res.error, "error");
      else toast(`${r.role} → ${STAGES.find((s) => s.key === status)?.label ?? status}`, "success");
    });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg">Hiring</h1>
          <p className="max-w-3xl text-sm text-muted">
            Who we plan to bring in, when, and what it commits us to.
          </p>
        </div>
        <button onClick={() => setCreating(true)} className="shrink-0 rounded-full bg-brand px-4 py-2 text-sm font-medium text-white">
          + Plan a role
        </button>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Roles open" value={String(stats.open)} />
        <KpiCard label="Filled" value={String(stats.hired)} tone={stats.hired ? "good" : "default"} />
        <KpiCard label="Adds to monthly cost" value={inrCompact(stats.runRate)}
          sub={stats.runRate ? `${inr(stats.runRate)} once all have started` : "nothing recorded"} />
        <KpiCard label="One-off cost" value={inrCompact(stats.oneOff)} sub="setup and recruitment" />
      </div>

      {roles.length === 0 ? (
        <EmptyState title="No roles planned" hint="A role here is a decision to spend from a month onwards." />
      ) : (
        <div className="space-y-5">
          {byMonth.map(([month, list]) => (
            <section key={month}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-faint">
                {month === "zzz" ? "No target month" : monthLabel(list[0].target_month)}
              </h2>
              <div className="space-y-2">
                {list.map((r) => (
                  <Card key={r.id} className="!p-0">
                    <div className="flex flex-wrap items-start gap-3 p-4">
                      <div className="min-w-0 flex-1">
                        <button onClick={() => setEditing(r)} className="font-medium text-fg hover:text-brand hover:underline">
                          {r.role}
                        </button>
                        <p className="text-xs text-muted">
                          {r.department || "No department"} · owned by {nameOf(r.owner_id)}
                        </p>
                        {r.reason && <p className="mt-1 text-xs text-muted">{r.reason}</p>}
                        {r.expected_output && (
                          <p className="mt-1 text-[11px] text-faint">Expected to deliver: {r.expected_output}</p>
                        )}
                      </div>

                      <div className="shrink-0 text-right">
                        <p className="font-display text-base font-bold tabular-nums text-fg">
                          {r.monthly_cost ? `${inrCompact(r.monthly_cost)}/mo` : "—"}
                        </p>
                        {(r.one_time_cost > 0 || r.recruitment_budget > 0) && (
                          <p className="text-[11px] text-faint">
                            + {inrCompact(r.one_time_cost + r.recruitment_budget)} one-off
                          </p>
                        )}
                        {r.start_date && <p className="text-[11px] text-faint">starts {shortDate(r.start_date)}</p>}
                      </div>

                      <div className="flex shrink-0 flex-wrap gap-1">
                        {STAGES.map((s) => (
                          <button key={s.key} disabled={saving || r.status === s.key}
                            onClick={() => move(r, s.key)}
                            className={`rounded-full px-2.5 py-1 text-[11px] font-medium disabled:opacity-100 ${
                              r.status === s.key ? "bg-brand text-white" : "border border-line text-muted hover:text-fg"}`}>
                            {s.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <RoleForm open={creating || !!editing} role={editing} people={people}
        onClose={() => { setCreating(false); setEditing(null); }} />
    </>
  );
}

function RoleForm({
  open, role, people, onClose,
}: { open: boolean; role: Role | null; people: Person[]; onClose: () => void }) {
  const [saving, start] = useTransition();
  const r = (n: number | undefined) => (n ? String(paiseToRupees(n)) : "");
  const [form, setForm] = useState(() => ({
    role: role?.role ?? "", department: role?.department ?? "",
    reason: role?.reason ?? "", expected_output: role?.expected_output ?? "",
    target_month: role?.target_month?.slice(0, 10) ?? "", start_date: role?.start_date?.slice(0, 10) ?? "",
    monthlyR: r(role?.monthly_cost), oneOffR: r(role?.one_time_cost), recruitR: r(role?.recruitment_budget),
    owner_id: role?.owner_id ?? "", status: role?.status ?? "not_started",
  }));
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal open={open} onClose={onClose} title={role ? `Edit ${role.role}` : "Plan a role"} wide>
      <form onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await saveRole(role?.id ?? null, {
            ...form,
            monthly_cost: rupeesToPaise(Number(form.monthlyR) || 0),
            one_time_cost: rupeesToPaise(Number(form.oneOffR) || 0),
            recruitment_budget: rupeesToPaise(Number(form.recruitR) || 0),
          });
          if ("error" in res && res.error) toast(res.error, "error");
          else { toast("Saved", "success"); onClose(); }
        });
      }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Role"><Input value={form.role} onChange={(e) => set("role", e.target.value)} required /></Field>
          </div>
          <Field label="Department"><Input value={form.department} onChange={(e) => set("department", e.target.value)} /></Field>
          <Field label="Status">
            <Select value={form.status} onChange={(e) => set("status", e.target.value)}>
              {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Why we need it"><Textarea rows={2} value={form.reason} onChange={(e) => set("reason", e.target.value)} /></Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="What they will deliver">
              <Textarea rows={2} value={form.expected_output} onChange={(e) => set("expected_output", e.target.value)}
                placeholder="Four pieces of content a week, and the podcast cut within three days" />
            </Field>
          </div>
          <Field label="Wanted by"><Input type="date" value={form.target_month} onChange={(e) => set("target_month", e.target.value)} /></Field>
          <Field label="Actually starts"><Input type="date" value={form.start_date} onChange={(e) => set("start_date", e.target.value)} /></Field>
          <Field label="Monthly cost (₹)"><Input type="number" min={0} value={form.monthlyR} onChange={(e) => set("monthlyR", e.target.value)} /></Field>
          <Field label="One-off cost (₹)"><Input type="number" min={0} value={form.oneOffR} onChange={(e) => set("oneOffR", e.target.value)} /></Field>
          <Field label="Recruitment budget (₹)"><Input type="number" min={0} value={form.recruitR} onChange={(e) => set("recruitR", e.target.value)} /></Field>
          <Field label="Who owns the hire">
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
