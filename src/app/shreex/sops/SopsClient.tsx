"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "@/components/Toast";
import { Card, KpiCard, EmptyState } from "@/components/os/ui";
import { Modal, Field, Input, Select, Textarea, FormActions } from "@/components/os/Modal";
import { useDialogChrome } from "@/components/os/useDialogChrome";
import { shortDate } from "@/lib/bos";
import {
  saveSop, draftNewVersion, saveVersion, saveSteps, publishVersion,
  acknowledgeVersion, startRun, setRunItem, finishRun,
} from "./actions";

export type SopDoc = {
  id: string; code: string | null; title: string; purpose: string | null;
  category: string | null; owner_id: string | null; state: string;
  review_every_days: number; next_review: string | null; updated_at: string;
};
export type SopVersion = {
  id: string; sop_id: string; version: number; body: string | null;
  change_note: string | null; author_id: string | null;
  approved_by: string | null; approved_at: string | null; created_at: string;
};
export type SopStep = {
  id: string; version_id: string; sort_order: number;
  instruction: string; pass_criteria: string | null; needs_evidence: boolean;
};
export type SopRun = {
  id: string; sop_id: string; version_id: string; event_id: string | null;
  label: string | null; run_by: string | null; started_at: string; completed_at: string | null;
};
export type SopRunItem = {
  id: string; run_id: string; step_id: string; state: string;
  note: string | null; evidence_url: string | null; checked_at: string | null;
};

type Person = { id: string; full_name: string | null; email: string | null };

const STATE_TONE: Record<string, string> = {
  draft: "bg-surface-2 text-muted",
  in_review: "bg-amber-100 text-amber-700",
  published: "bg-green-100 text-green-700",
  retired: "bg-surface-2 text-faint",
};

const ITEM_TONE: Record<string, string> = {
  pending: "border-line text-muted",
  pass: "border-green-500 bg-green-500/10 text-green-700",
  fail: "border-red-500 bg-red-500/10 text-red-600",
  na: "border-line bg-surface-2 text-faint",
};

export function SopsClient({
  docs, versions, steps, acks, runs, runItems, events, people, isAdmin, meId,
}: {
  docs: SopDoc[]; versions: SopVersion[]; steps: SopStep[];
  acks: { version_id: string; user_id: string; acknowledged_at: string }[];
  runs: SopRun[]; runItems: SopRunItem[];
  events: { id: string; title: string; date: string }[];
  people: Person[]; isAdmin: boolean; meId: string | null;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<SopDoc | null>(null);
  const [creating, setCreating] = useState(false);

  const nameOf = (id: string | null) => people.find((p) => p.id === id)?.full_name ?? "—";

  // The newest approved version, or the newest draft where none is approved —
  // the same rule as bos_sop_current, so the page and the database agree.
  const currentOf = (sopId: string) => {
    const mine = versions.filter((v) => v.sop_id === sopId);
    return mine.find((v) => v.approved_at) ?? mine[0] ?? null;
  };

  const staffCount = people.filter((p) => p.id).length;
  const overdue = docs.filter(
    (d) => d.next_review && d.next_review < new Date().toISOString().slice(0, 10),
  ).length;
  const unpublished = docs.filter((d) => d.state !== "published").length;

  const open = openId ? docs.find((d) => d.id === openId) ?? null : null;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg">SOPs &amp; Quality</h1>
          <p className="max-w-3xl text-sm text-muted">
            How we do things, which version is current, who has read it, and whether it was
            actually followed. A change is a new version, so an acknowledgement always refers to
            the words somebody really saw.
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setCreating(true)}
            className="shrink-0 rounded-full bg-brand px-4 py-2 text-sm font-medium text-white"
          >
            + New procedure
          </button>
        )}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Procedures" value={String(docs.length)} />
        <KpiCard label="Not yet published" value={String(unpublished)} tone={unpublished ? "warn" : "good"} />
        <KpiCard label="Overdue for review" value={String(overdue)} tone={overdue ? "warn" : "good"} />
        <KpiCard label="Runs recorded" value={String(runs.length)} />
      </div>

      {docs.length === 0 ? (
        <EmptyState
          title="No procedures yet"
          hint="Write the first one — how the door is run, how an event is closed down, how a refund is handled."
        />
      ) : (
        <Card className="!p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[54rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-faint">
                  <th className="px-5 py-2.5 font-semibold">Procedure</th>
                  <th className="px-3 py-2.5 font-semibold">Owner</th>
                  <th className="px-3 py-2.5 font-semibold">Version</th>
                  <th className="px-3 py-2.5 font-semibold">Read by</th>
                  <th className="px-3 py-2.5 font-semibold">Next review</th>
                  <th className="px-3 py-2.5 font-semibold">State</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => {
                  const cur = currentOf(d.id);
                  const read = cur ? acks.filter((a) => a.version_id === cur.id).length : 0;
                  const late = d.next_review && d.next_review < new Date().toISOString().slice(0, 10);
                  return (
                    <tr key={d.id} className="border-b border-line/60 last:border-0 hover:bg-surface-2">
                      <td className="px-5 py-2.5">
                        <button
                          onClick={() => setOpenId(d.id)}
                          className="text-left font-medium text-fg hover:text-brand hover:underline"
                        >
                          {d.code ? <span className="mr-1.5 font-mono text-[11px] text-faint">{d.code}</span> : null}
                          {d.title}
                        </button>
                        {d.purpose && <p className="text-xs text-muted">{d.purpose}</p>}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted">{nameOf(d.owner_id)}</td>
                      <td className="px-3 py-2.5 text-xs tabular-nums text-muted">
                        {cur ? `v${cur.version}` : "—"}
                        {cur && !cur.approved_at && <span className="ml-1 text-amber-600">draft</span>}
                      </td>
                      <td className="px-3 py-2.5 text-xs tabular-nums text-muted">
                        {read} of {staffCount}
                      </td>
                      <td className={`px-3 py-2.5 text-xs ${late ? "font-semibold text-red-600" : "text-muted"}`}>
                        {d.next_review ? shortDate(d.next_review) : "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATE_TONE[d.state] ?? ""}`}>
                          {d.state.replace("_", " ")}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {open && (
        <SopDrawer
          key={open.id}
          doc={open}
          versions={versions.filter((v) => v.sop_id === open.id)}
          steps={steps}
          acks={acks}
          runs={runs.filter((r) => r.sop_id === open.id)}
          runItems={runItems}
          events={events}
          people={people}
          isAdmin={isAdmin}
          meId={meId}
          onClose={() => setOpenId(null)}
          onEdit={() => {
            setEditing(open);
            setOpenId(null);
          }}
        />
      )}

      <SopForm
        open={creating || !!editing}
        doc={editing}
        people={people}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
    </>
  );
}

// ─────────────────────────── The document form ───────────────────────────

function SopForm({
  open, doc, people, onClose,
}: { open: boolean; doc: SopDoc | null; people: Person[]; onClose: () => void }) {
  const [saving, start] = useTransition();
  const [form, setForm] = useState(() => ({
    code: doc?.code ?? "",
    title: doc?.title ?? "",
    purpose: doc?.purpose ?? "",
    category: doc?.category ?? "",
    owner_id: doc?.owner_id ?? "",
    review_every_days: String(doc?.review_every_days ?? 180),
  }));
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal open={open} onClose={onClose} title={doc ? "Edit procedure" : "New procedure"}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await saveSop(doc?.id ?? null, form);
            if ("error" in res && res.error) toast(res.error, "error");
            else {
              toast(doc ? "Saved" : "Created — write the first draft", "success");
              onClose();
            }
          });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Code"><Input value={form.code} onChange={(e) => set("code", e.target.value)} placeholder="SOP-01" /></Field>
          <Field label="Category"><Input value={form.category} onChange={(e) => set("category", e.target.value)} placeholder="Events" /></Field>
          <div className="sm:col-span-2">
            <Field label="Title"><Input value={form.title} onChange={(e) => set("title", e.target.value)} required /></Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="What it is for"><Textarea rows={2} value={form.purpose} onChange={(e) => set("purpose", e.target.value)} /></Field>
          </div>
          <Field label="Owner">
            <Select value={form.owner_id} onChange={(e) => set("owner_id", e.target.value)}>
              <option value="">Nobody</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
            </Select>
          </Field>
          <Field label="Review every (days)">
            <Input type="number" min={1} value={form.review_every_days} onChange={(e) => set("review_every_days", e.target.value)} />
          </Field>
        </div>
        <FormActions onCancel={onClose} saving={saving} submitLabel={doc ? "Save" : "Create"} />
      </form>
    </Modal>
  );
}

// ─────────────────────────── One procedure, opened ───────────────────────────

function SopDrawer({
  doc, versions, steps, acks, runs, runItems, events, people, isAdmin, meId, onClose, onEdit,
}: {
  doc: SopDoc; versions: SopVersion[]; steps: SopStep[];
  acks: { version_id: string; user_id: string; acknowledged_at: string }[];
  runs: SopRun[]; runItems: SopRunItem[];
  events: { id: string; title: string; date: string }[];
  people: Person[]; isAdmin: boolean; meId: string | null;
  onClose: () => void; onEdit: () => void;
}) {
  useDialogChrome(true, onClose);
  const [saving, start] = useTransition();
  const [tab, setTab] = useState<"procedure" | "readers" | "runs">("procedure");
  const [viewing, setViewing] = useState(() => versions.find((v) => v.approved_at) ?? versions[0] ?? null);
  const [body, setBody] = useState(viewing?.body ?? "");
  const [note, setNote] = useState(viewing?.change_note ?? "");
  const [draftSteps, setDraftSteps] = useState(() =>
    steps.filter((s) => s.version_id === viewing?.id).map((s) => ({
      instruction: s.instruction, pass_criteria: s.pass_criteria ?? "", needs_evidence: s.needs_evidence,
    })),
  );
  const [runLabel, setRunLabel] = useState("");
  const [runEvent, setRunEvent] = useState("");
  const [openRun, setOpenRun] = useState<string | null>(null);

  const nameOf = (id: string | null) => people.find((p) => p.id === id)?.full_name ?? "Someone";
  const editable = isAdmin && viewing && !viewing.approved_at;
  const mySteps = useMemo(
    () => steps.filter((s) => s.version_id === viewing?.id).sort((a, b) => a.sort_order - b.sort_order),
    [steps, viewing],
  );
  const readers = acks.filter((a) => a.version_id === viewing?.id);
  const iHaveRead = readers.some((r) => r.user_id === meId);

  const run = (fn: () => Promise<{ error?: string } | { success: boolean }>, ok: string) =>
    start(async () => {
      const res = await fn();
      if (res && "error" in res && res.error) toast(res.error, "error");
      else toast(ok, "success");
    });

  const pick = (v: SopVersion) => {
    setViewing(v);
    setBody(v.body ?? "");
    setNote(v.change_note ?? "");
    setDraftSteps(
      steps.filter((s) => s.version_id === v.id).map((s) => ({
        instruction: s.instruction, pass_criteria: s.pass_criteria ?? "", needs_evidence: s.needs_evidence,
      })),
    );
  };

  const field = "w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-fg outline-none focus:border-brand";

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto overscroll-contain p-4 sm:p-8">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex min-h-full items-center justify-center">
        <div role="dialog" aria-modal="true" aria-label={doc.title}
          className="w-full max-w-4xl overflow-hidden rounded-2xl border border-line bg-surface shadow-soft">

          <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
            <div className="min-w-0">
              <p className="text-[11px] text-faint">
                {doc.code ?? "No code"} · owned by {nameOf(doc.owner_id)}
                {doc.next_review ? ` · review by ${shortDate(doc.next_review)}` : ""}
              </p>
              <h3 className="mt-0.5 font-display text-lg font-bold text-fg">{doc.title}</h3>
              {doc.purpose && <p className="text-sm text-muted">{doc.purpose}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {isAdmin && (
                <button onClick={onEdit} className="rounded-full border border-line px-3 py-1.5 text-xs font-medium text-muted hover:text-fg">
                  Settings
                </button>
              )}
              <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-ink-2 hover:text-fg">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>

          <div className="flex gap-2 border-b border-line px-6 py-2.5">
            {(["procedure", "readers", "runs"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium capitalize ${
                  tab === t ? "bg-brand text-white" : "border border-line text-muted hover:text-fg"}`}>
                {t === "readers" ? `Read by (${readers.length})` : t === "runs" ? `Runs (${runs.length})` : "Procedure"}
              </button>
            ))}
          </div>

          <div className="max-h-[60vh] overflow-y-auto p-6">
            {tab === "procedure" && (
              <div className="grid gap-5 md:grid-cols-[1fr_13rem]">
                <div className="min-w-0 space-y-3">
                  {editable ? (
                    <>
                      <Field label="The procedure">
                        <Textarea rows={7} value={body} onChange={(e) => setBody(e.target.value)}
                          placeholder="What this covers, when it applies, and anything that is not obvious from the steps." />
                      </Field>
                      <Field label="What changed in this version">
                        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Added the photo step" />
                      </Field>

                      <div>
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">Steps</p>
                        <div className="space-y-2">
                          {draftSteps.map((s, i) => (
                            <div key={i} className="rounded-lg border border-line p-2.5">
                              <div className="flex items-start gap-2">
                                <span className="mt-1.5 text-xs tabular-nums text-faint">{i + 1}.</span>
                                <div className="flex-1 space-y-1.5">
                                  <input className={field} value={s.instruction} placeholder="What to do"
                                    onChange={(e) => setDraftSteps((d) => d.map((x, n) => n === i ? { ...x, instruction: e.target.value } : x))} />
                                  <input className={field} value={s.pass_criteria} placeholder="How you know it passed"
                                    onChange={(e) => setDraftSteps((d) => d.map((x, n) => n === i ? { ...x, pass_criteria: e.target.value } : x))} />
                                  <label className="flex items-center gap-1.5 text-[11px] text-muted">
                                    <input type="checkbox" checked={s.needs_evidence}
                                      onChange={(e) => setDraftSteps((d) => d.map((x, n) => n === i ? { ...x, needs_evidence: e.target.checked } : x))} />
                                    Needs evidence
                                  </label>
                                </div>
                                <button onClick={() => setDraftSteps((d) => d.filter((_, n) => n !== i))}
                                  className="text-xs text-red-600 hover:underline">Remove</button>
                              </div>
                            </div>
                          ))}
                        </div>
                        <button onClick={() => setDraftSteps((d) => [...d, { instruction: "", pass_criteria: "", needs_evidence: false }])}
                          className="mt-2 rounded-full border border-line px-3 py-1.5 text-xs font-medium text-muted hover:text-fg">
                          + Add a step
                        </button>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button disabled={saving}
                          onClick={() => run(async () => {
                            const a = await saveVersion(viewing!.id, { body, change_note: note });
                            if ("error" in a && a.error) return a;
                            return saveSteps(viewing!.id, draftSteps);
                          }, "Draft saved")}
                          className="rounded-full border border-line px-4 py-2 text-sm font-medium text-fg disabled:opacity-40">
                          Save draft
                        </button>
                        <button disabled={saving}
                          onClick={() => run(async () => {
                            const a = await saveVersion(viewing!.id, { body, change_note: note });
                            if ("error" in a && a.error) return a;
                            const b = await saveSteps(viewing!.id, draftSteps);
                            if ("error" in b && b.error) return b;
                            return publishVersion(viewing!.id);
                          }, "Approved and published")}
                          className="rounded-full bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
                          Approve &amp; publish
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="whitespace-pre-wrap text-sm text-fg">
                        {viewing?.body || "Nothing written yet."}
                      </p>
                      <ol className="mt-3 space-y-2">
                        {mySteps.map((s, i) => (
                          <li key={s.id} className="rounded-lg border border-line bg-surface-2/40 px-3 py-2">
                            <p className="text-sm text-fg"><span className="text-faint">{i + 1}. </span>{s.instruction}</p>
                            {s.pass_criteria && <p className="mt-0.5 text-xs text-muted">Pass when: {s.pass_criteria}</p>}
                            {s.needs_evidence && <p className="text-[11px] text-amber-600">Evidence required</p>}
                          </li>
                        ))}
                        {mySteps.length === 0 && <li className="text-xs text-faint">No steps in this version.</li>}
                      </ol>

                      {viewing?.approved_at && (
                        <button
                          disabled={saving || iHaveRead}
                          onClick={() => run(() => acknowledgeVersion(viewing.id), "Noted — thank you")}
                          className="mt-3 rounded-full bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                        >
                          {iHaveRead ? `You read v${viewing.version}` : `I have read v${viewing.version}`}
                        </button>
                      )}
                      {isAdmin && (
                        <button disabled={saving}
                          onClick={() => run(() => draftNewVersion(doc.id), "New draft started")}
                          className="mt-3 ml-2 rounded-full border border-line px-4 py-2 text-sm font-medium text-muted hover:text-fg disabled:opacity-40">
                          Start v{(versions[0]?.version ?? 0) + 1}
                        </button>
                      )}
                    </>
                  )}
                </div>

                <aside>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">Versions</p>
                  <ul className="space-y-1">
                    {versions.map((v) => (
                      <li key={v.id}>
                        <button onClick={() => pick(v)}
                          className={`w-full rounded-lg px-2.5 py-1.5 text-left text-xs ${
                            viewing?.id === v.id ? "bg-brand/10 font-semibold text-brand-soft" : "text-muted hover:bg-surface-2"}`}>
                          v{v.version}
                          {v.approved_at
                            ? <span className="ml-1 text-green-600">approved</span>
                            : <span className="ml-1 text-amber-600">draft</span>}
                          <span className="block text-[10px] text-faint">
                            {v.approved_at ? `${nameOf(v.approved_by)} · ${shortDate(v.approved_at)}` : shortDate(v.created_at)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </aside>
              </div>
            )}

            {tab === "readers" && (
              <div>
                <p className="mb-2 text-xs text-muted">
                  Who has said they read <strong>v{viewing?.version}</strong>. Reading an earlier
                  version does not count — that is the point of versioning it.
                </p>
                <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
                  {people.map((p) => {
                    const a = readers.find((r) => r.user_id === p.id);
                    return (
                      <li key={p.id} className="flex items-center justify-between gap-3 bg-surface px-4 py-2">
                        <span className="text-sm text-fg">{p.full_name || p.email}</span>
                        {a ? (
                          <span className="text-[11px] text-green-600">Read {shortDate(a.acknowledged_at)}</span>
                        ) : (
                          <span className="text-[11px] text-faint">Not yet</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {tab === "runs" && (
              <div className="space-y-4">
                {viewing?.approved_at && (
                  <div className="rounded-xl border border-line p-3">
                    <p className="mb-2 text-xs font-semibold text-fg">Carry it out</p>
                    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                      <input className={field} value={runLabel} onChange={(e) => setRunLabel(e.target.value)} placeholder="What for — October meetup" />
                      <select className={field} value={runEvent} onChange={(e) => setRunEvent(e.target.value)}>
                        <option value="">Not tied to an event</option>
                        {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
                      </select>
                      <button disabled={saving}
                        onClick={() => run(() => startRun(doc.id, viewing.id, runLabel, runEvent), "Started")}
                        className="rounded-full bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
                        Start
                      </button>
                    </div>
                  </div>
                )}

                {runs.length === 0 ? (
                  <p className="text-xs text-faint">Nothing carried out yet.</p>
                ) : (
                  runs.map((r) => {
                    const items = runItems.filter((i) => i.run_id === r.id);
                    const passed = items.filter((i) => i.state === "pass").length;
                    const failed = items.filter((i) => i.state === "fail").length;
                    const isOpen = openRun === r.id;
                    return (
                      <div key={r.id} className="rounded-xl border border-line">
                        <button onClick={() => setOpenRun(isOpen ? null : r.id)}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-left">
                          <span className="flex-1 text-sm font-medium text-fg">
                            {r.label || "Unlabelled run"}
                            <span className="ml-1.5 text-[11px] font-normal text-faint">
                              v{versions.find((v) => v.id === r.version_id)?.version ?? "?"} · {nameOf(r.run_by)} · {shortDate(r.started_at)}
                            </span>
                          </span>
                          <span className="text-xs tabular-nums text-muted">
                            {passed}/{items.length}
                            {failed > 0 && <span className="ml-1 text-red-600">· {failed} failed</span>}
                          </span>
                          {r.completed_at && <span className="text-[11px] text-green-600">closed</span>}
                        </button>

                        {isOpen && (
                          <div className="space-y-1.5 border-t border-line p-3">
                            {items.map((it) => {
                              const step = steps.find((s) => s.id === it.step_id);
                              return (
                                <div key={it.id} className={`rounded-lg border px-3 py-2 ${ITEM_TONE[it.state] ?? ""}`}>
                                  <p className="text-sm">{step?.instruction ?? "Step"}</p>
                                  {step?.pass_criteria && <p className="text-[11px] opacity-80">Pass when: {step.pass_criteria}</p>}
                                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                                    {(["pass", "fail", "na"] as const).map((st) => (
                                      <button key={st} disabled={saving || !!r.completed_at}
                                        onClick={() => run(() => setRunItem(it.id, st), "Recorded")}
                                        className={`rounded-full border px-2.5 py-1 text-[11px] font-medium disabled:opacity-40 ${
                                          it.state === st ? "border-current" : "border-line text-muted"}`}>
                                        {st === "na" ? "N/A" : st}
                                      </button>
                                    ))}
                                  </div>
                                  {it.note && <p className="mt-1 text-[11px]">{it.note}</p>}
                                </div>
                              );
                            })}
                            {!r.completed_at && (
                              <button disabled={saving}
                                onClick={() => run(() => finishRun(r.id), "Closed")}
                                className="mt-1 rounded-full border border-line px-3 py-1.5 text-xs font-medium text-muted hover:text-fg disabled:opacity-40">
                                Close this run
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
