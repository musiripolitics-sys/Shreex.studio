"use client";

import { useState, useTransition } from "react";
import { toast } from "@/components/Toast";
import { Modal, Field, Input, Textarea, Select, FormActions } from "@/components/os/Modal";
import { Card, EmptyState } from "@/components/os/ui";
import { inr, pct, shortDate, rupeesToPaise, paiseToRupees } from "@/lib/bos";
import { saveEventOps } from "./actions";
import { EventForm } from "./EventForm";
import Link from "next/link";

export type EventRow = {
  id: string;
  title: string;
  category: string;
  date: string;
  city: string;
  status: string;
  capacity: number;
  host_name: string | null;
  registrations: number;
  attendance: number;
  revenue: number;
};

export type EventOps = {
  id: string;
  event_id: string;
  event_type: string | null;
  is_client_event: boolean;
  client_name: string | null;
  owner_id: string | null;
  budget: number;
  actual_cost: number;
  revenue_target: number;
  marketing_campaign_id: string | null;
  partners: string | null;
  feedback: string | null;
};

const EVENT_TYPES = ["Webinar", "Meetup", "Hackathon", "Workshop", "Networking", "Conference", "Product Launch", "Podcast", "Career Session", "Community Event", "Client Event"];

export function EventsClient({
  rows,
  ops,
  campaigns,
  owners,
}: {
  rows: EventRow[];
  ops: Record<string, EventOps>;
  campaigns: { id: string; name: string }[];
  owners: { id: string; full_name: string | null; email: string | null }[];
}) {
  const [open, setOpen] = useState(false);
  const [ev, setEv] = useState<EventRow | null>(null);
  const [pending, start] = useTransition();
  const blank = {
    event_type: "", is_client_event: false, client_name: "", owner_id: "",
    budgetRupees: "", costRupees: "", revTargetRupees: "", marketing_campaign_id: "", partners: "", feedback: "",
  };
  const [form, setForm] = useState({ ...blank });

  const edit = (e: EventRow) => {
    setEv(e);
    const o = ops[e.id];
    setForm({
      event_type: o?.event_type ?? e.category ?? "",
      is_client_event: o?.is_client_event ?? false,
      client_name: o?.client_name ?? "",
      owner_id: o?.owner_id ?? "",
      budgetRupees: o?.budget ? String(paiseToRupees(o.budget)) : "",
      costRupees: o?.actual_cost ? String(paiseToRupees(o.actual_cost)) : "",
      revTargetRupees: o?.revenue_target ? String(paiseToRupees(o.revenue_target)) : "",
      marketing_campaign_id: o?.marketing_campaign_id ?? "",
      partners: o?.partners ?? "",
      feedback: o?.feedback ?? "",
    });
    setOpen(true);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ev) return;
    start(async () => {
      const res = await saveEventOps({
        event_id: ev.id,
        event_type: form.event_type || null,
        is_client_event: form.is_client_event,
        client_name: form.client_name || null,
        owner_id: form.owner_id || null,
        budget: rupeesToPaise(Number(form.budgetRupees || 0)),
        actual_cost: rupeesToPaise(Number(form.costRupees || 0)),
        revenue_target: rupeesToPaise(Number(form.revTargetRupees || 0)),
        marketing_campaign_id: form.marketing_campaign_id || null,
        partners: form.partners || null,
        feedback: form.feedback || null,
      });
      if (res?.error) toast(res.error, "error");
      else { toast("Event financials saved", "success"); setOpen(false); }
    });
  };

  const ownerName = (id: string | null) => owners.find((o) => o.id === id)?.full_name || "—";
  // The event itself is edited here now, not only in the old console.
  const [creating, setCreating] = useState(false);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg">Events</h1>
          <p className="max-w-3xl text-sm text-muted">
            Every event on the website is written here. Open one to edit what the public page
            shows, see tickets sold against capacity, and run the door. Cost, target, client and
            campaign are OS-only — profit and ROI compute from them.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="shrink-0 rounded-full bg-brand px-4 py-2 text-sm font-medium text-white"
        >
          + New event
        </button>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No events yet" hint="Create the first one and publish it to the website." />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-faint">
                <th className="px-4 py-3 font-semibold">Event</th>
                <th className="px-3 py-3 font-semibold">Type</th>
                <th className="px-3 py-3 font-semibold">Date</th>
                <th className="px-3 py-3 text-right font-semibold">Reg / Cap</th>
                <th className="px-3 py-3 text-right font-semibold">Attend</th>
                <th className="px-3 py-3 text-right font-semibold">Revenue</th>
                <th className="px-3 py-3 text-right font-semibold">Cost</th>
                <th className="px-3 py-3 text-right font-semibold">Profit</th>
                <th className="px-3 py-3 text-right font-semibold">ROI</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const o = ops[e.id];
                const cost = o?.actual_cost ?? 0;
                const profit = e.revenue - cost;
                const roi = cost > 0 ? (profit / cost) * 100 : null;
                const regRate = e.capacity > 0 ? (e.registrations / e.capacity) * 100 : null;
                const attRate = e.registrations > 0 ? (e.attendance / e.registrations) * 100 : null;
                return (
                  <tr key={e.id} className="border-b border-line/60 last:border-0 hover:bg-surface-2">
                    <td className="px-4 py-3">
                      <Link
                        href={`/shreex/events/${e.id}`}
                        className="font-medium text-fg hover:text-brand hover:underline"
                      >
                        {e.title}
                      </Link>
                      <p className="text-xs text-muted">
                        {e.status}{o?.is_client_event ? ` · Client${o.client_name ? `: ${o.client_name}` : ""}` : " · Owned"}
                        {o?.owner_id ? ` · ${ownerName(o.owner_id)}` : ""}
                      </p>
                    </td>
                    <td className="px-3 py-3 text-muted">{o?.event_type ?? e.category}</td>
                    <td className="px-3 py-3 text-xs text-muted">{shortDate(e.date)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted">
                      {e.registrations}/{e.capacity || "—"}
                      {regRate != null && <span className="block text-[11px] text-faint">{pct(regRate)}</span>}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted">
                      {e.attendance}
                      {attRate != null && <span className="block text-[11px] text-faint">{pct(attRate)}</span>}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-green-600">{inr(e.revenue)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-amber-600">{cost ? inr(cost) : "—"}</td>
                    <td className={`px-3 py-3 text-right tabular-nums font-medium ${profit >= 0 ? "text-green-600" : "text-red-600"}`}>{inr(profit)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted">{roi != null ? `${roi.toFixed(0)}%` : "—"}</td>
                    <td className="px-3 py-3 text-right">
                      <Link href={`/shreex/events/${e.id}`} className="text-xs font-medium text-brand-soft hover:underline">Open</Link>
                      <button onClick={() => edit(e)} className="ml-3 text-xs font-medium text-muted hover:text-fg hover:underline">Ops</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={ev ? `Event ops · ${ev.title}` : "Event ops"} wide>
        <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Event type">
            <Select value={form.event_type} onChange={(e) => setForm({ ...form, event_type: e.target.value })}>
              <option value="">—</option>
              {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="Owner">
            <Select value={form.owner_id} onChange={(e) => setForm({ ...form, owner_id: e.target.value })}>
              <option value="">—</option>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.full_name || o.email}</option>)}
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={form.is_client_event} onChange={(e) => setForm({ ...form, is_client_event: e.target.checked })} />
            External client event
          </label>
          <Field label="Client name">
            <Input value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} />
          </Field>
          <Field label="Budget (₹)"><Input type="number" min={0} step="0.01" value={form.budgetRupees} onChange={(e) => setForm({ ...form, budgetRupees: e.target.value })} /></Field>
          <Field label="Actual cost (₹)"><Input type="number" min={0} step="0.01" value={form.costRupees} onChange={(e) => setForm({ ...form, costRupees: e.target.value })} /></Field>
          <Field label="Revenue target (₹)"><Input type="number" min={0} step="0.01" value={form.revTargetRupees} onChange={(e) => setForm({ ...form, revTargetRupees: e.target.value })} /></Field>
          <Field label="Marketing campaign">
            <Select value={form.marketing_campaign_id} onChange={(e) => setForm({ ...form, marketing_campaign_id: e.target.value })}>
              <option value="">—</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <div className="sm:col-span-2"><Field label="Partners"><Input value={form.partners} onChange={(e) => setForm({ ...form, partners: e.target.value })} /></Field></div>
          <div className="sm:col-span-2"><Field label="Feedback"><Textarea rows={2} value={form.feedback} onChange={(e) => setForm({ ...form, feedback: e.target.value })} /></Field></div>
          <div className="sm:col-span-2"><FormActions onCancel={() => setOpen(false)} saving={pending} submitLabel="Save event ops" /></div>
        </form>
      </Modal>

      <EventForm open={creating} onClose={() => setCreating(false)} event={null} owners={owners} />
    </>
  );
}
