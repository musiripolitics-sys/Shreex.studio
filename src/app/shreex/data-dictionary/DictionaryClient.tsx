"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "@/components/Toast";
import { Card, KpiCard, EmptyState } from "@/components/os/ui";
import { Modal, Field, Input, Select, Textarea, FormActions } from "@/components/os/Modal";
import { saveField, deleteField } from "./actions";

export type DataField = {
  id: string; table_name: string; column_name: string; description: string | null;
  classification: string; is_personal: boolean; lawful_basis: string | null;
  retention_days: number | null; source_system: string | null;
  owner_id: string | null; notes: string | null;
};

type Person = { id: string; full_name: string | null; email: string | null };

const CLASSES = [
  { v: "public", label: "Public", tone: "bg-surface-2 text-muted", hint: "Anyone may see it" },
  { v: "internal", label: "Internal", tone: "bg-blue-100 text-blue-700", hint: "Staff only" },
  { v: "confidential", label: "Confidential", tone: "bg-amber-100 text-amber-700", hint: "Need to know" },
  { v: "personal", label: "Personal", tone: "bg-red-100 text-red-700", hint: "Identifies a person" },
];

const years = (d: number | null) =>
  d == null ? "Not set" : d >= 365 ? `${(d / 365).toFixed(d % 365 ? 1 : 0)} years` : `${d} days`;

/**
 * What we hold, where, and for how long.
 *
 * The point of the classification is not the label — it is that a field
 * marked personal has to answer two further questions: on what basis we keep
 * it, and for how long. A dictionary that records the name of a column and
 * nothing else is a schema dump.
 */
export function DictionaryClient({ fields, people }: { fields: DataField[]; people: Person[] }) {
  const [editing, setEditing] = useState<DataField | null>(null);
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState("");
  const [onlyPersonal, setOnlyPersonal] = useState(false);

  const nameOf = (id: string | null) => people.find((p) => p.id === id)?.full_name ?? "—";

  const stats = useMemo(() => {
    const personal = fields.filter((f) => f.is_personal);
    return {
      total: fields.length,
      tables: new Set(fields.map((f) => f.table_name)).size,
      personal: personal.length,
      // Personal data with no retention period is the thing a regulator asks
      // about first, so it is counted rather than buried.
      unbounded: personal.filter((f) => f.retention_days == null).length,
    };
  }, [fields]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return fields.filter((f) => {
      if (onlyPersonal && !f.is_personal) return false;
      if (!needle) return true;
      return [f.table_name, f.column_name, f.description, f.source_system].some((v) =>
        (v ?? "").toLowerCase().includes(needle),
      );
    });
  }, [fields, q, onlyPersonal]);

  const grouped = useMemo(() => {
    const m = new Map<string, DataField[]>();
    for (const f of shown) {
      if (!m.has(f.table_name)) m.set(f.table_name, []);
      m.get(f.table_name)!.push(f);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [shown]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg">Data dictionary</h1>
          <p className="max-w-3xl text-sm text-muted">
            What each field holds, who is accountable for it, how sensitive it is, and how long we
            keep it. Anything personal needs a reason and an end date.
          </p>
        </div>
        <button onClick={() => setCreating(true)} className="shrink-0 rounded-full bg-brand px-4 py-2 text-sm font-medium text-white">
          + Document a field
        </button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Fields documented" value={String(stats.total)} sub={`across ${stats.tables} tables`} />
        <KpiCard label="Hold personal data" value={String(stats.personal)} />
        <KpiCard label="Personal, kept forever" value={String(stats.unbounded)} tone={stats.unbounded ? "warn" : "good"}
          sub={stats.unbounded ? "no retention period set" : "all bounded"} />
        <KpiCard label="Owned" value={String(fields.filter((f) => f.owner_id).length)} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Table, column or description…"
          className="w-64 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-fg outline-none focus:border-brand" />
        <button onClick={() => setOnlyPersonal((v) => !v)}
          className={`rounded-full px-3 py-1.5 text-xs font-medium ${
            onlyPersonal ? "bg-brand text-white" : "border border-line text-muted hover:text-fg"}`}>
          Personal data only
        </button>
      </div>

      {grouped.length === 0 ? (
        <EmptyState title="Nothing documented yet"
          hint="Start with the fields that hold personal data — attendee emails, phone numbers, payment references." />
      ) : (
        <div className="space-y-4">
          {grouped.map(([table, rows]) => (
            <Card key={table} className="!p-0">
              <div className="border-b border-line px-5 py-2.5">
                <h2 className="font-mono text-sm font-semibold text-fg">{table}</h2>
                <p className="text-[11px] text-faint">{rows.length} field{rows.length === 1 ? "" : "s"}</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[52rem] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-faint">
                      <th className="px-5 py-2 font-semibold">Column</th>
                      <th className="px-3 py-2 font-semibold">Class</th>
                      <th className="px-3 py-2 font-semibold">Basis</th>
                      <th className="px-3 py-2 font-semibold">Kept for</th>
                      <th className="px-3 py-2 font-semibold">Owner</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((f) => {
                      const cls = CLASSES.find((c) => c.v === f.classification) ?? CLASSES[1];
                      return (
                        <tr key={f.id} className="border-b border-line/60 last:border-0 hover:bg-surface-2">
                          <td className="px-5 py-2">
                            <button onClick={() => setEditing(f)} className="text-left font-mono text-xs font-medium text-fg hover:text-brand hover:underline">
                              {f.column_name}
                            </button>
                            {f.description && <p className="text-xs text-muted">{f.description}</p>}
                          </td>
                          <td className="px-3 py-2">
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls.tone}`}>{cls.label}</span>
                          </td>
                          <td className="px-3 py-2 text-xs text-muted">{f.lawful_basis ?? (f.is_personal ? "—" : "n/a")}</td>
                          <td className={`px-3 py-2 text-xs ${f.is_personal && f.retention_days == null ? "font-semibold text-amber-600" : "text-muted"}`}>
                            {years(f.retention_days)}
                          </td>
                          <td className="px-3 py-2 text-xs text-muted">{nameOf(f.owner_id)}</td>
                          <td className="px-3 py-2 text-right">
                            <button onClick={() => setEditing(f)} className="text-xs font-medium text-brand-soft hover:underline">Edit</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </div>
      )}

      <FieldForm open={creating || !!editing} field={editing} people={people}
        onClose={() => { setCreating(false); setEditing(null); }} />
    </>
  );
}

function FieldForm({
  open, field, people, onClose,
}: { open: boolean; field: DataField | null; people: Person[]; onClose: () => void }) {
  const [saving, start] = useTransition();
  const [form, setForm] = useState(() => ({
    table_name: field?.table_name ?? "", column_name: field?.column_name ?? "",
    description: field?.description ?? "", classification: field?.classification ?? "internal",
    is_personal: field?.is_personal ?? false, lawful_basis: field?.lawful_basis ?? "",
    retention_days: field?.retention_days != null ? String(field.retention_days) : "",
    source_system: field?.source_system ?? "", owner_id: field?.owner_id ?? "",
    notes: field?.notes ?? "",
  }));
  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));
  const personal = form.classification === "personal" || form.is_personal;

  return (
    <Modal open={open} onClose={onClose} title={field ? "Edit field" : "Document a field"} wide>
      <form onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await saveField(field?.id ?? null, {
            ...form,
            retention_days: form.retention_days === "" ? null : form.retention_days,
          });
          if ("error" in res && res.error) toast(res.error, "error");
          else { toast("Saved", "success"); onClose(); }
        });
      }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Table"><Input value={form.table_name} onChange={(e) => set("table_name", e.target.value)} placeholder="registrations" required /></Field>
          <Field label="Column"><Input value={form.column_name} onChange={(e) => set("column_name", e.target.value)} placeholder="attendee_email" required /></Field>
          <div className="sm:col-span-2">
            <Field label="What it holds"><Input value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Where the ticket is sent" /></Field>
          </div>
          <Field label="Classification">
            <Select value={form.classification} onChange={(e) => set("classification", e.target.value)}>
              {CLASSES.map((c) => <option key={c.v} value={c.v}>{c.label} — {c.hint}</option>)}
            </Select>
          </Field>
          <Field label="Where it comes from"><Input value={form.source_system} onChange={(e) => set("source_system", e.target.value)} placeholder="Registration form" /></Field>

          {personal && (
            <>
              <Field label="Why we may hold it">
                <Select value={form.lawful_basis} onChange={(e) => set("lawful_basis", e.target.value)}>
                  <option value="">Not decided</option>
                  {["Contract", "Consent", "Legitimate interest", "Legal obligation"].map((b) => <option key={b} value={b}>{b}</option>)}
                </Select>
              </Field>
              <Field label="Kept for (days) — blank means forever">
                <Input type="number" min={0} value={form.retention_days} onChange={(e) => set("retention_days", e.target.value)} placeholder="1095" />
              </Field>
            </>
          )}

          <Field label="Accountable for it">
            <Select value={form.owner_id} onChange={(e) => set("owner_id", e.target.value)}>
              <option value="">Nobody</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Notes"><Textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
          </div>
        </div>

        {personal && !form.retention_days && (
          <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
            Personal data with no retention period is kept forever. That is a decision — make it
            deliberately, or set an end date.
          </p>
        )}

        <div className="mt-3 flex items-center justify-between gap-3">
          {field ? (
            <button type="button"
              onClick={() => start(async () => {
                const res = await deleteField(field.id);
                if ("error" in res && res.error) toast(res.error, "error");
                else { toast("Removed", "success"); onClose(); }
              })}
              className="text-xs font-medium text-red-600 hover:underline">
              Remove from the dictionary
            </button>
          ) : <span />}
          <FormActions onCancel={onClose} saving={saving} submitLabel="Save" />
        </div>
      </form>
    </Modal>
  );
}
