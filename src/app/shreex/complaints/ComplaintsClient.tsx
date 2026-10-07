"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "@/components/Toast";
import { Card, KpiCard, EmptyState } from "@/components/os/ui";
import { Modal, Field, Input, Select, Textarea, FormActions } from "@/components/os/Modal";
import { useDialogChrome } from "@/components/os/useDialogChrome";
import { ChangeHistory, type Change } from "@/components/os/ChangeHistory";
import { shortDate } from "@/lib/bos";
import { saveComplaint, setComplaintState } from "./actions";

export type Complaint = {
  id: string; ref: string | null; channel: string | null;
  complainant: string | null; contact_email: string | null;
  subject: string; detail: string | null; severity: number; state: string;
  owner_id: string | null; event_id: string | null;
  received_at: string; acknowledge_by: string | null; acknowledged_at: string | null;
  resolve_by: string | null; resolved_at: string | null;
  root_cause: string | null; resolution: string | null;
};

type Person = { id: string; full_name: string | null; email: string | null };

const STATES = ["new", "acknowledged", "investigating", "awaiting", "resolved", "closed"] as const;
const OPEN_STATES = ["new", "acknowledged", "investigating", "awaiting"];

const SEVERITY = [
  { v: 1, label: "1 · Serious", tone: "bg-red-100 text-red-700" },
  { v: 2, label: "2 · High", tone: "bg-amber-100 text-amber-700" },
  { v: 3, label: "3 · Normal", tone: "bg-blue-100 text-blue-700" },
  { v: 4, label: "4 · Minor", tone: "bg-surface-2 text-muted" },
];

const hoursLeft = (iso: string | null) =>
  iso ? Math.round((new Date(iso).getTime() - Date.now()) / 3600000) : null;

/** How long is left, or how far past. The wording matters more than the number. */
function Clock({ due, done }: { due: string | null; done: string | null }) {
  if (done) return <span className="text-[11px] text-green-600">done</span>;
  const h = hoursLeft(due);
  if (h === null) return <span className="text-[11px] text-faint">—</span>;
  if (h < 0) {
    const late = Math.abs(h);
    return (
      <span className="text-[11px] font-semibold text-red-600">
        {late < 48 ? `${late}h late` : `${Math.round(late / 24)}d late`}
      </span>
    );
  }
  return (
    <span className={`text-[11px] ${h < 12 ? "font-semibold text-amber-600" : "text-muted"}`}>
      {h < 48 ? `${h}h left` : `${Math.round(h / 24)}d left`}
    </span>
  );
}

/**
 * Complaints, on the clock.
 *
 * Two deadlines rather than one, because they answer different questions and
 * people judge them separately: how long before somebody replied at all, and
 * how long before it was actually fixed. A complaint that is answered within
 * the hour and resolved in a week reads very differently from one that sat
 * unacknowledged for six days.
 */
export function ComplaintsClient({
  rows, changes, events, people,
}: {
  rows: Complaint[]; changes: Change[];
  events: { id: string; title: string; date: string }[]; people: Person[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Complaint | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<"open" | "all">("open");

  const nameOf = (id: string | null) => people.find((p) => p.id === id)?.full_name ?? "—";

  const stats = useMemo(() => {
    const open = rows.filter((r) => OPEN_STATES.includes(r.state));
    const lateAck = open.filter(
      (r) => !r.acknowledged_at && r.acknowledge_by && new Date(r.acknowledge_by) < new Date(),
    );
    const lateFix = open.filter((r) => r.resolve_by && new Date(r.resolve_by) < new Date());
    const closed = rows.filter((r) => r.resolved_at);
    const avgDays =
      closed.length > 0
        ? closed.reduce(
            (a, r) =>
              a + (new Date(r.resolved_at!).getTime() - new Date(r.received_at).getTime()) / 864e5,
            0,
          ) / closed.length
        : null;
    return { open: open.length, lateAck: lateAck.length, lateFix: lateFix.length, avgDays };
  }, [rows]);

  const shown = filter === "open" ? rows.filter((r) => OPEN_STATES.includes(r.state)) : rows;
  const open = openId ? rows.find((r) => r.id === openId) ?? null : null;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg">Complaints</h1>
          <p className="max-w-3xl text-sm text-muted">
            Every complaint, who owns it, and two clocks: one to reply, one to fix. Both start when
            it arrives, not when somebody notices it.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="shrink-0 rounded-full bg-brand px-4 py-2 text-sm font-medium text-white"
        >
          + Log a complaint
        </button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Open" value={String(stats.open)} />
        <KpiCard label="Unacknowledged past deadline" value={String(stats.lateAck)} tone={stats.lateAck ? "warn" : "good"} />
        <KpiCard label="Past the fix deadline" value={String(stats.lateFix)} tone={stats.lateFix ? "warn" : "good"} />
        <KpiCard
          label="Average time to resolve"
          value={stats.avgDays != null ? `${stats.avgDays.toFixed(1)} days` : "No data yet"}
        />
      </div>

      <div className="mb-3 flex gap-2">
        {(["open", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium capitalize ${
              filter === f ? "bg-brand text-white" : "border border-line text-muted hover:text-fg"
            }`}
          >
            {f === "open" ? `Open (${stats.open})` : `Everything (${rows.length})`}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState
          title={filter === "open" ? "Nothing outstanding" : "No complaints logged"}
          hint="Log one when it arrives — by email, at an event, or through the contact form."
        />
      ) : (
        <Card className="!p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-faint">
                  <th className="px-5 py-2.5 font-semibold">Complaint</th>
                  <th className="px-3 py-2.5 font-semibold">Severity</th>
                  <th className="px-3 py-2.5 font-semibold">Owner</th>
                  <th className="px-3 py-2.5 font-semibold">Reply</th>
                  <th className="px-3 py-2.5 font-semibold">Fix</th>
                  <th className="px-3 py-2.5 font-semibold">State</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const sev = SEVERITY.find((s) => s.v === r.severity) ?? SEVERITY[2];
                  return (
                    <tr key={r.id} className="border-b border-line/60 last:border-0 hover:bg-surface-2">
                      <td className="px-5 py-2.5">
                        <button
                          onClick={() => setOpenId(r.id)}
                          className="text-left font-medium text-fg hover:text-brand hover:underline"
                        >
                          {r.ref && <span className="mr-1.5 font-mono text-[11px] text-faint">{r.ref}</span>}
                          {r.subject}
                        </button>
                        <p className="text-xs text-muted">
                          {r.complainant ?? "Anonymous"}
                          {r.channel ? ` · ${r.channel}` : ""} · {shortDate(r.received_at)}
                        </p>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${sev.tone}`}>
                          {sev.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted">{nameOf(r.owner_id)}</td>
                      <td className="px-3 py-2.5"><Clock due={r.acknowledge_by} done={r.acknowledged_at} /></td>
                      <td className="px-3 py-2.5"><Clock due={r.resolve_by} done={r.resolved_at} /></td>
                      <td className="px-3 py-2.5 text-xs capitalize text-muted">{r.state}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {open && (
        <ComplaintDrawer
          key={open.id}
          row={open}
          changes={changes.filter((c) => c.entity_id === open.id)}
          nameOf={nameOf}
          onClose={() => setOpenId(null)}
          onEdit={() => { setEditing(open); setOpenId(null); }}
        />
      )}

      <ComplaintForm
        open={creating || !!editing}
        row={editing}
        people={people}
        events={events}
        onClose={() => { setCreating(false); setEditing(null); }}
      />
    </>
  );
}

function ComplaintDrawer({
  row, changes, nameOf, onClose, onEdit,
}: {
  row: Complaint; changes: Change[];
  nameOf: (id: string | null) => string; onClose: () => void; onEdit: () => void;
}) {
  useDialogChrome(true, onClose);
  const [saving, start] = useTransition();

  const move = (state: string) =>
    start(async () => {
      const res = await setComplaintState(row.id, state);
      if ("error" in res && res.error) toast(res.error, "error");
      else toast(`Moved to ${state}`, "success");
    });

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto overscroll-contain p-4 sm:p-8">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex min-h-full items-center justify-center">
        <div role="dialog" aria-modal="true" aria-label={row.subject}
          className="w-full max-w-3xl overflow-hidden rounded-2xl border border-line bg-surface shadow-soft">
          <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
            <div className="min-w-0">
              <p className="text-[11px] text-faint">
                {row.ref} · received {shortDate(row.received_at)}
                {row.channel ? ` · ${row.channel}` : ""}
              </p>
              <h3 className="mt-0.5 font-display text-lg font-bold text-fg">{row.subject}</h3>
              <p className="text-sm text-muted">
                {row.complainant ?? "Anonymous"}
                {row.contact_email ? ` · ${row.contact_email}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button onClick={onEdit} className="rounded-full border border-line px-3 py-1.5 text-xs font-medium text-muted hover:text-fg">
                Edit
              </button>
              <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-ink-2 hover:text-fg">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>

          <div className="grid gap-5 p-6 md:grid-cols-[1.3fr_1fr]">
            <div className="min-w-0 space-y-4">
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">What they said</p>
                <p className="whitespace-pre-wrap text-sm text-fg">{row.detail || "No detail recorded."}</p>
              </div>
              {row.root_cause && (
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">Root cause</p>
                  <p className="text-sm text-fg">{row.root_cause}</p>
                </div>
              )}
              {row.resolution && (
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">What we did</p>
                  <p className="text-sm text-fg">{row.resolution}</p>
                </div>
              )}
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">Move it on</p>
                <div className="flex flex-wrap gap-1.5">
                  {STATES.map((s) => (
                    <button key={s} disabled={saving || row.state === s} onClick={() => move(s)}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize disabled:opacity-40 ${
                        row.state === s ? "bg-brand text-white" : "border border-line text-muted hover:text-fg"}`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <aside className="space-y-4">
              <dl className="space-y-1.5 text-xs">
                <div><dt className="inline text-faint">Owner: </dt><dd className="inline text-fg">{nameOf(row.owner_id)}</dd></div>
                <div><dt className="inline text-faint">Reply by: </dt><dd className="inline"><Clock due={row.acknowledge_by} done={row.acknowledged_at} /></dd></div>
                <div><dt className="inline text-faint">Fix by: </dt><dd className="inline"><Clock due={row.resolve_by} done={row.resolved_at} /></dd></div>
              </dl>
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">History</p>
                <ChangeHistory changes={changes} nameOf={nameOf} />
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}

function ComplaintForm({
  open, row, people, events, onClose,
}: {
  open: boolean; row: Complaint | null; people: Person[];
  events: { id: string; title: string; date: string }[]; onClose: () => void;
}) {
  const [saving, start] = useTransition();
  const [form, setForm] = useState(() => ({
    subject: row?.subject ?? "", detail: row?.detail ?? "",
    channel: row?.channel ?? "", complainant: row?.complainant ?? "",
    contact_email: row?.contact_email ?? "", severity: String(row?.severity ?? 3),
    owner_id: row?.owner_id ?? "", event_id: row?.event_id ?? "",
    root_cause: row?.root_cause ?? "", resolution: row?.resolution ?? "",
  }));
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal open={open} onClose={onClose} title={row ? "Edit complaint" : "Log a complaint"} wide>
      <form onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await saveComplaint(row?.id ?? null, form);
          if ("error" in res && res.error) toast(res.error, "error");
          else { toast(row ? "Saved" : "Logged — the clock is running", "success"); onClose(); }
        });
      }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="What is the complaint"><Input value={form.subject} onChange={(e) => set("subject", e.target.value)} required /></Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="In their words"><Textarea rows={4} value={form.detail} onChange={(e) => set("detail", e.target.value)} /></Field>
          </div>
          <Field label="Who complained"><Input value={form.complainant} onChange={(e) => set("complainant", e.target.value)} /></Field>
          <Field label="Their email"><Input type="email" value={form.contact_email} onChange={(e) => set("contact_email", e.target.value)} /></Field>
          <Field label="How it reached us">
            <Select value={form.channel} onChange={(e) => set("channel", e.target.value)}>
              <option value="">Not recorded</option>
              {["Email", "Contact form", "In person", "Phone", "Social media"].map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Severity — this sets the deadlines">
            <Select value={form.severity} onChange={(e) => set("severity", e.target.value)}>
              {SEVERITY.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
            </Select>
          </Field>
          <Field label="Owner">
            <Select value={form.owner_id} onChange={(e) => set("owner_id", e.target.value)}>
              <option value="">Nobody yet</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
            </Select>
          </Field>
          <Field label="About an event">
            <Select value={form.event_id} onChange={(e) => set("event_id", e.target.value)}>
              <option value="">Not event-related</option>
              {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
            </Select>
          </Field>
          {row && (
            <>
              <div className="sm:col-span-2">
                <Field label="Root cause — why it happened, not what happened">
                  <Textarea rows={2} value={form.root_cause} onChange={(e) => set("root_cause", e.target.value)} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="What we did about it">
                  <Textarea rows={2} value={form.resolution} onChange={(e) => set("resolution", e.target.value)} />
                </Field>
              </div>
            </>
          )}
        </div>
        <FormActions onCancel={onClose} saving={saving} submitLabel={row ? "Save" : "Log it"} />
      </form>
    </Modal>
  );
}
