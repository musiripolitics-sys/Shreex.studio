"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "@/components/Toast";
import { Modal, Field, Input, Textarea, Select, FormActions } from "@/components/os/Modal";
import { Card, StatusBadge, PriorityBadge, StageBadge, EmptyState } from "@/components/os/ui";
import {
  BOS_STATUSES, BOS_PRIORITIES, BOS_FREQUENCIES, CRM_STAGES,
  STATUS_META, STAGE_META, freqLabel, inr, num, shortDate, paiseToRupees,
  type BosStatus, type BosPriority, type CrmStage,
} from "@/lib/bos";
import type { ModuleConfig, Field as FieldCfg } from "@/lib/os-modules";
import { saveRecord, deleteRecord } from "@/app/admin/os/records/actions";

export type RefOptions = {
  owners: { id: string; full_name: string | null; email: string | null }[];
  workstreams: { id: string; name: string; color: string | null }[];
  events: { id: string; title: string }[];
  goals: { id: string; objective: string }[];
  campaigns: { id: string; name: string }[];
};

type Row = Record<string, unknown> & { id: string };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function ModuleTable({
  config,
  rows,
  options,
}: {
  config: ModuleConfig;
  rows: Row[];
  options: RefOptions;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [fStatus, setFStatus] = useState("");
  const [fPriority, setFPriority] = useState("");
  const [fStage, setFStage] = useState("");
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();

  const ownerName = (id: unknown) =>
    options.owners.find((o) => o.id === id)?.full_name ||
    options.owners.find((o) => o.id === id)?.email ||
    (id ? "—" : "—");
  const wsMap = useMemo(
    () => Object.fromEntries(options.workstreams.map((w) => [w.id, w])),
    [options.workstreams],
  );

  const filtered = rows.filter((r) => {
    if (config.filters?.includes("status") && fStatus && r.status !== fStatus) return false;
    if (config.filters?.includes("priority") && fPriority && r.priority !== fPriority) return false;
    if (config.filters?.includes("stage") && fStage && r.stage !== fStage) return false;
    if (q) {
      const hay = config.columns.map((c) => String(r[c.key] ?? "")).join(" ").toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  const blankForm = () => {
    const f: Record<string, string | boolean> = {};
    for (const fld of config.fields) {
      f[fld.key] = fld.type === "checkbox" ? false
        : fld.type === "status" ? "not_started"
        : fld.type === "priority" ? "medium"
        : fld.type === "frequency" ? "one_time"
        : fld.type === "stage" ? "lead"
        : fld.type === "date" ? "" : "";
    }
    return f;
  };

  const openNew = () => { setEditing(null); setForm(blankForm()); setOpen(true); };
  const openEdit = (r: Row) => {
    setEditing(r);
    const f: Record<string, string | boolean> = {};
    for (const fld of config.fields) {
      const v = r[fld.key];
      if (fld.type === "checkbox") f[fld.key] = Boolean(v);
      else if (fld.type === "money") f[fld.key] = v != null ? String(paiseToRupees(Number(v))) : "";
      else f[fld.key] = v != null ? String(v) : "";
    }
    setForm(f);
    setOpen(true);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const res = await saveRecord(config.key, editing?.id ?? null, form);
      if (res?.error) toast(res.error, "error");
      else { toast(editing ? "Saved" : "Added", "success"); setOpen(false); }
    });
  };

  const remove = (r: Row) => {
    if (!confirm("Delete this record? This cannot be undone.")) return;
    start(async () => {
      const res = await deleteRecord(config.key, r.id);
      if (res?.error) toast(res.error, "error");
      else toast("Deleted", "success");
    });
  };

  const selectCls = "rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-fg outline-none focus:border-brand";

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg">{config.title}</h1>
          <p className="text-sm text-muted">{config.desc}</p>
        </div>
        {!config.readOnly && (
          <button onClick={openNew} className="rounded-full bg-brand px-4 py-2 text-sm font-medium text-white">
            + Add
          </button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search…"
          className={`${selectCls} min-w-[180px]`}
        />
        {config.filters?.includes("status") && (
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={selectCls}>
            <option value="">All statuses</option>
            {BOS_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
          </select>
        )}
        {config.filters?.includes("priority") && (
          <select value={fPriority} onChange={(e) => setFPriority(e.target.value)} className={selectCls}>
            <option value="">All priorities</option>
            {BOS_PRIORITIES.map((p) => <option key={p} value={p}>{cap(p)}</option>)}
          </select>
        )}
        {config.filters?.includes("stage") && (
          <select value={fStage} onChange={(e) => setFStage(e.target.value)} className={selectCls}>
            <option value="">All stages</option>
            {CRM_STAGES.map((s) => <option key={s} value={s}>{STAGE_META[s].label}</option>)}
          </select>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={rows.length === 0 ? "No data yet" : "Nothing matches"}
          hint={rows.length === 0 ? "Add your first record to get started." : "Try clearing the filters."}
        />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-faint">
                {config.columns.map((c) => (
                  <th key={c.key} className={`px-3 py-3 font-semibold ${c.align === "right" ? "text-right" : ""}`}>
                    {c.label}
                  </th>
                ))}
                {!config.readOnly && <th className="px-3 py-3" />}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-line/60 last:border-0 hover:bg-surface-2">
                  {config.columns.map((c) => (
                    <td key={c.key} className={`px-3 py-3 ${c.align === "right" ? "text-right tabular-nums" : ""}`}>
                      {renderCell(c, r, { ownerName, wsMap })}
                    </td>
                  ))}
                  {!config.readOnly && (
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      <button onClick={() => openEdit(r)} className="text-xs font-medium text-brand-soft hover:underline">Edit</button>
                      <button onClick={() => remove(r)} className="ml-3 text-xs font-medium text-red-600 hover:underline">Delete</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {!config.readOnly && (
        <Modal open={open} onClose={() => setOpen(false)} title={editing ? `Edit ${config.title}` : `Add to ${config.title}`} wide>
          <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {config.fields.map((fld) => (
              <div key={fld.key} className={fld.span2 || fld.type === "textarea" ? "sm:col-span-2" : ""}>
                {fld.type === "checkbox" ? (
                  <label className="flex items-center gap-2 pt-6 text-sm text-muted">
                    <input
                      type="checkbox"
                      checked={Boolean(form[fld.key])}
                      onChange={(e) => setForm({ ...form, [fld.key]: e.target.checked })}
                    />
                    {fld.label}
                  </label>
                ) : (
                  <Field label={fld.required ? `${fld.label} *` : fld.label}>
                    {renderInput(fld, form, setForm, options)}
                  </Field>
                )}
              </div>
            ))}
            <div className="sm:col-span-2">
              <FormActions onCancel={() => setOpen(false)} saving={pending} submitLabel={editing ? "Save changes" : "Add"} />
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function renderCell(
  c: ModuleConfig["columns"][number],
  r: Row,
  helpers: { ownerName: (id: unknown) => string; wsMap: Record<string, { name: string; color: string | null }> },
) {
  const v = r[c.key];
  switch (c.type) {
    case "money":
      return <span className="text-fg">{v != null ? inr(Number(v)) : "—"}</span>;
    case "number":
      return <span className="text-muted">{v != null && v !== "" ? num(Number(v)) : "—"}</span>;
    case "pct":
      return <span className="text-muted">{v != null ? `${Number(v)}%` : "—"}</span>;
    case "date":
      return <span className="text-xs text-muted">{v ? shortDate(String(v)) : "—"}</span>;
    case "status":
      return <StatusBadge status={(v as BosStatus) ?? "not_started"} />;
    case "priority":
      return <PriorityBadge priority={(v as BosPriority) ?? "medium"} />;
    case "stage":
      return <StageBadge stage={(v as CrmStage) ?? "lead"} />;
    case "owner":
      return <span className="text-muted">{helpers.ownerName(v)}</span>;
    case "workstream": {
      const ws = v ? helpers.wsMap[String(v)] : null;
      return ws ? (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted">
          <span className="h-2 w-2 rounded-full" style={{ background: ws.color ?? "#999" }} />
          {ws.name}
        </span>
      ) : "—";
    }
    case "bool":
      return <span className="text-muted">{v ? "Yes" : "No"}</span>;
    case "chip":
      return v ? <span className="rounded-full bg-ink-2 px-2 py-0.5 text-xs capitalize text-muted">{String(v).replace(/_/g, " ")}</span> : "—";
    default: {
      const sub = c.sub ? r[c.sub] : null;
      return (
        <div>
          <p className="font-medium text-fg">{v != null && v !== "" ? String(v) : "—"}</p>
          {sub != null && sub !== "" && <p className="text-xs text-muted">{String(sub)}</p>}
        </div>
      );
    }
  }
}

function renderInput(
  fld: FieldCfg,
  form: Record<string, string | boolean>,
  setForm: (f: Record<string, string | boolean>) => void,
  options: RefOptions,
) {
  const val = (form[fld.key] as string) ?? "";
  const set = (v: string) => setForm({ ...form, [fld.key]: v });

  switch (fld.type) {
    case "textarea":
      return <Textarea rows={2} value={val} onChange={(e) => set(e.target.value)} placeholder={fld.placeholder} />;
    case "number":
      return <Input type="number" step="any" value={val} onChange={(e) => set(e.target.value)} placeholder={fld.placeholder} />;
    case "money":
      return <Input type="number" min={0} step="0.01" value={val} onChange={(e) => set(e.target.value)} />;
    case "date":
      return <Input type="date" value={val} required={fld.required} onChange={(e) => set(e.target.value)} />;
    case "select":
      return (
        <Select value={val} required={fld.required} onChange={(e) => set(e.target.value)}>
          <option value="">—</option>
          {fld.options?.map((o) => <option key={o} value={o} className="capitalize">{o.replace(/_/g, " ")}</option>)}
        </Select>
      );
    case "status":
      return (
        <Select value={val} onChange={(e) => set(e.target.value)}>
          {BOS_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </Select>
      );
    case "priority":
      return (
        <Select value={val} onChange={(e) => set(e.target.value)}>
          {BOS_PRIORITIES.map((p) => <option key={p} value={p}>{cap(p)}</option>)}
        </Select>
      );
    case "frequency":
      return (
        <Select value={val} onChange={(e) => set(e.target.value)}>
          {BOS_FREQUENCIES.map((f) => <option key={f} value={f}>{freqLabel(f)}</option>)}
        </Select>
      );
    case "stage":
      return (
        <Select value={val} onChange={(e) => set(e.target.value)}>
          {CRM_STAGES.map((s) => <option key={s} value={s}>{STAGE_META[s].label}</option>)}
        </Select>
      );
    case "owner":
      return (
        <Select value={val} required={fld.required} onChange={(e) => set(e.target.value)}>
          <option value="">—</option>
          {options.owners.map((o) => <option key={o.id} value={o.id}>{o.full_name || o.email}</option>)}
        </Select>
      );
    case "workstream":
      return (
        <Select value={val} onChange={(e) => set(e.target.value)}>
          <option value="">—</option>
          {options.workstreams.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
      );
    case "event":
      return (
        <Select value={val} onChange={(e) => set(e.target.value)}>
          <option value="">—</option>
          {options.events.map((ev) => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
        </Select>
      );
    case "goal":
      return (
        <Select value={val} onChange={(e) => set(e.target.value)}>
          <option value="">—</option>
          {options.goals.map((g) => <option key={g.id} value={g.id}>{g.objective}</option>)}
        </Select>
      );
    case "campaign":
      return (
        <Select value={val} onChange={(e) => set(e.target.value)}>
          <option value="">—</option>
          {options.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      );
    default:
      return <Input value={val} required={fld.required} onChange={(e) => set(e.target.value)} placeholder={fld.placeholder} />;
  }
}
