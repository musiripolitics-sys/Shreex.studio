"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import { toast } from "@/components/Toast";
import { KpiCard, EmptyState } from "@/components/os/ui";
import { Modal, Field, Input, Select, Textarea, FormActions } from "@/components/os/Modal";
import { shortDate } from "@/lib/bos";
import { saveModule, setModuleEnvironment } from "@/lib/team-actions";

export type Module = {
  id: string; module: string; feature: string | null; user_story: string | null;
  owner_id: string | null; developer: string | null; qa: string | null;
  environment: string | null; status: string; priority: string;
  bug_count: number; release: string | null; target_date: string | null;
};

type Person = { id: string; full_name: string | null; email: string | null };

// Where a thing has got to is the question; what state the work is in is a
// detail of that. So the board is environments and status is a chip.
const ENVIRONMENTS = [
  { key: "development", label: "Development", hint: "Being built" },
  { key: "staging", label: "Staging", hint: "Being checked" },
  { key: "production", label: "Production", hint: "Live for people" },
];

const STATUS_TONE: Record<string, string> = {
  not_started: "bg-surface-2 text-muted",
  in_progress: "bg-blue-100 text-blue-700",
  blocked: "bg-red-100 text-red-700",
  completed: "bg-green-100 text-green-700",
  on_hold: "bg-amber-100 text-amber-700",
  cancelled: "bg-surface-2 text-faint",
};

const PRIORITY_TONE: Record<string, string> = {
  critical: "text-red-600", high: "text-amber-600", medium: "text-muted", low: "text-faint",
};

/**
 * What is being built, and how close it is to people.
 *
 * Columns are environments rather than statuses, because "in progress" tells
 * you nothing a reader can act on and "still in development while marked
 * complete" is the thing worth noticing. Status rides along as a chip.
 */
export function ProductClient({ modules, people }: { modules: Module[]; people: Person[] }) {
  const [editing, setEditing] = useState<Module | null>(null);
  const [creating, setCreating] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [saving, start] = useTransition();

  const [rows, setRows] = useOptimistic(
    modules,
    (state: Module[], p: { id: string; environment: string }) =>
      state.map((m) => (m.id === p.id ? { ...m, environment: p.environment } : m)),
  );

  const nameOf = (id: string | null) => people.find((p) => p.id === id)?.full_name ?? null;

  const stats = useMemo(() => ({
    total: rows.length,
    live: rows.filter((m) => m.environment === "production").length,
    blocked: rows.filter((m) => m.status === "blocked").length,
    bugs: rows.reduce((a, m) => a + (m.bug_count ?? 0), 0),
  }), [rows]);

  const move = (id: string, environment: string) => {
    const m = rows.find((x) => x.id === id);
    if (!m || m.environment === environment) return;
    start(async () => {
      setRows({ id, environment });
      const res = await setModuleEnvironment(id, environment);
      if ("error" in res && res.error) toast(res.error, "error");
    });
  };

  const unplaced = rows.filter((m) => !m.environment || !ENVIRONMENTS.some((e) => e.key === m.environment));

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg">Product</h1>
          <p className="max-w-3xl text-sm text-muted">
            What is being built and how close it is to the people using it. Drag a module to move it
            along.
          </p>
        </div>
        <button onClick={() => setCreating(true)} className="shrink-0 rounded-full bg-brand px-4 py-2 text-sm font-medium text-white">
          + Add a module
        </button>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Modules" value={String(stats.total)} />
        <KpiCard label="In production" value={String(stats.live)} tone={stats.live ? "good" : "default"}
          sub={stats.total ? `${Math.round((stats.live / stats.total) * 100)}% shipped` : undefined} />
        <KpiCard label="Blocked" value={String(stats.blocked)} tone={stats.blocked ? "warn" : "good"} />
        <KpiCard label="Open bugs" value={String(stats.bugs)} tone={stats.bugs ? "warn" : "good"} />
      </div>

      {rows.length === 0 ? (
        <EmptyState title="Nothing tracked yet" hint="Add the parts of the product and move them as they ship." />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            {ENVIRONMENTS.map((env) => {
              const list = rows.filter((m) => m.environment === env.key);
              return (
                <section key={env.key}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(env.key); }}
                  onDragLeave={() => setDragOver((d) => (d === env.key ? null : d))}
                  onDrop={(e) => {
                    e.preventDefault(); setDragOver(null);
                    const id = e.dataTransfer.getData("text/plain");
                    if (id) move(id, env.key);
                  }}
                  className={`rounded-2xl border p-2.5 ${
                    dragOver === env.key ? "border-brand bg-brand/5" : "border-line bg-surface-2/40"}`}>
                  <header className="mb-2 flex items-baseline gap-2 px-1">
                    <h2 className="flex-1 text-xs font-semibold uppercase tracking-wider text-fg">{env.label}</h2>
                    <span className="text-xs tabular-nums text-faint">{list.length}</span>
                  </header>
                  <div className="space-y-2">
                    {list.length === 0 ? (
                      <p className="px-1 py-3 text-center text-[11px] text-faint">{env.hint}</p>
                    ) : list.map((m) => (
                      <article key={m.id} draggable={!saving}
                        onDragStart={(e) => e.dataTransfer.setData("text/plain", m.id)}
                        onClick={() => setEditing(m)}
                        className="cursor-pointer rounded-xl border border-line bg-surface p-2.5 shadow-sm hover:shadow-md">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium leading-snug text-fg">{m.module}</p>
                          <span className={`shrink-0 text-[10px] font-semibold uppercase ${PRIORITY_TONE[m.priority] ?? ""}`}>
                            {m.priority}
                          </span>
                        </div>
                        {m.feature && <p className="mt-0.5 text-[11px] leading-snug text-muted">{m.feature}</p>}
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${STATUS_TONE[m.status] ?? ""}`}>
                            {m.status.replace("_", " ")}
                          </span>
                          {m.bug_count > 0 && (
                            <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                              {m.bug_count} bug{m.bug_count === 1 ? "" : "s"}
                            </span>
                          )}
                          {m.release && <span className="text-[10px] text-faint">{m.release}</span>}
                        </div>
                        {(nameOf(m.owner_id) || m.developer || m.target_date) && (
                          <p className="mt-1 truncate text-[10px] text-faint">
                            {[nameOf(m.owner_id), m.developer, m.target_date ? shortDate(m.target_date) : null]
                              .filter(Boolean).join(" · ")}
                          </p>
                        )}
                      </article>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>

          {unplaced.length > 0 && (
            <section className="mt-4 rounded-2xl border border-dashed border-line p-3">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-faint">
                Nowhere yet — drag these into an environment
              </h2>
              <div className="flex flex-wrap gap-2">
                {unplaced.map((m) => (
                  <button key={m.id} draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", m.id)}
                    onClick={() => setEditing(m)}
                    className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-fg hover:border-brand">
                    {m.module}
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <ModuleForm open={creating || !!editing} module={editing} people={people}
        onClose={() => { setCreating(false); setEditing(null); }} />
    </>
  );
}

function ModuleForm({
  open, module, people, onClose,
}: { open: boolean; module: Module | null; people: Person[]; onClose: () => void }) {
  const [saving, start] = useTransition();
  const [form, setForm] = useState(() => ({
    module: module?.module ?? "", feature: module?.feature ?? "",
    user_story: module?.user_story ?? "", owner_id: module?.owner_id ?? "",
    developer: module?.developer ?? "", qa: module?.qa ?? "",
    environment: module?.environment ?? "development",
    status: module?.status ?? "not_started", priority: module?.priority ?? "medium",
    bug_count: String(module?.bug_count ?? ""), release: module?.release ?? "",
    target_date: module?.target_date?.slice(0, 10) ?? "",
  }));
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal open={open} onClose={onClose} title={module ? `Edit ${module.module}` : "Add a module"} wide>
      <form onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await saveModule(module?.id ?? null, { ...form, bug_count: form.bug_count || 0 });
          if ("error" in res && res.error) toast(res.error, "error");
          else { toast("Saved", "success"); onClose(); }
        });
      }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Module"><Input value={form.module} onChange={(e) => set("module", e.target.value)} required /></Field>
          <Field label="Release"><Input value={form.release} onChange={(e) => set("release", e.target.value)} placeholder="v1.2" /></Field>
          <div className="sm:col-span-2">
            <Field label="What it covers"><Input value={form.feature} onChange={(e) => set("feature", e.target.value)} /></Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Who it is for and why">
              <Textarea rows={2} value={form.user_story} onChange={(e) => set("user_story", e.target.value)}
                placeholder="As a host, I can see who has registered, so I know whether to promote harder" />
            </Field>
          </div>
          <Field label="Environment">
            <Select value={form.environment} onChange={(e) => set("environment", e.target.value)}>
              {ENVIRONMENTS.map((e2) => <option key={e2.key} value={e2.key}>{e2.label}</option>)}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(e) => set("status", e.target.value)}>
              {["not_started","in_progress","blocked","completed","on_hold","cancelled"].map((s) =>
                <option key={s} value={s}>{s.replace("_"," ")}</option>)}
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={form.priority} onChange={(e) => set("priority", e.target.value)}>
              {["critical","high","medium","low"].map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </Field>
          <Field label="Open bugs"><Input type="number" min={0} value={form.bug_count} onChange={(e) => set("bug_count", e.target.value)} /></Field>
          <Field label="Owner">
            <Select value={form.owner_id} onChange={(e) => set("owner_id", e.target.value)}>
              <option value="">Nobody</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
            </Select>
          </Field>
          <Field label="Target date"><Input type="date" value={form.target_date} onChange={(e) => set("target_date", e.target.value)} /></Field>
          <Field label="Developer"><Input value={form.developer} onChange={(e) => set("developer", e.target.value)} /></Field>
          <Field label="Tested by"><Input value={form.qa} onChange={(e) => set("qa", e.target.value)} /></Field>
        </div>
        <FormActions onCancel={onClose} saving={saving} submitLabel="Save" />
      </form>
    </Modal>
  );
}
