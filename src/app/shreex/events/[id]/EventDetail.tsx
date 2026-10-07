"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "@/components/Toast";
import { Card, KpiCard, EmptyState } from "@/components/os/ui";
import { Icon } from "@/components/Icon";
import { inr, pct, shortDate } from "@/lib/bos";
import { setEventStatus } from "../actions";
import { EventForm } from "../EventForm";

export type EventFull = {
  id: string; slug: string; title: string; category: string;
  date: string; end_date: string | null; time: string | null;
  city: string; venue: string | null; address: string | null;
  price_type: string; price_amount: number; price_label: string | null;
  capacity: number; blurb: string | null; about: string | null;
  image_url: string | null; status: string;
  host_id: string | null; host_name: string | null; published_at: string | null;
};

export type Registration = {
  id: string;
  attendee_name: string | null;
  attendee_email: string | null;
  attendee_phone: string | null;
  status: string;
  ticket_code: string | null;
  checked_in_at: string | null;
  registered_at: string;
};

const STATUS_TONE: Record<string, string> = {
  draft: "bg-surface-2 text-muted",
  pending_review: "bg-amber-100 text-amber-700",
  approved: "bg-blue-100 text-blue-700",
  published: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
  completed: "bg-surface-2 text-muted",
};

export function EventDetail({
  event,
  registrations,
  revenue,
  owners,
}: {
  event: EventFull;
  registrations: Registration[];
  revenue: number;
  owners: { id: string; full_name: string | null; email: string | null }[];
}) {
  const [editing, setEditing] = useState(false);
  const [saving, start] = useTransition();
  const [q, setQ] = useState("");

  const stats = useMemo(() => {
    const live = registrations.filter((r) => r.status === "registered" || r.status === "attended");
    const attended = registrations.filter((r) => r.status === "attended" || r.checked_in_at);
    return {
      sold: live.length,
      waitlisted: registrations.filter((r) => r.status === "waitlisted").length,
      cancelled: registrations.filter((r) => r.status === "cancelled").length,
      attended: attended.length,
      // Capacity 0 means unlimited, which is not the same as sold out.
      remaining: event.capacity > 0 ? Math.max(0, event.capacity - live.length) : null,
      fill: event.capacity > 0 ? live.length / event.capacity : null,
      showRate: live.length > 0 ? attended.length / live.length : null,
    };
  }, [registrations, event.capacity]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return registrations;
    return registrations.filter((r) =>
      [r.attendee_name, r.attendee_email, r.ticket_code].some((v) =>
        (v ?? "").toLowerCase().includes(needle),
      ),
    );
  }, [registrations, q]);

  const move = (status: string) =>
    start(async () => {
      const res = await setEventStatus(event.id, status);
      if ("error" in res && res.error) toast(res.error, "error");
      else toast(status === "published" ? "Published to the website" : `Moved to ${status}`, "success");
    });

  return (
    <>
      {/* ── Header ── */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[event.status] ?? ""}`}>
              {event.status.replace("_", " ")}
            </span>
            <span className="text-xs text-faint">{event.category}</span>
            {event.status === "published" && (
              <Link
                href={`/events/${event.slug}`}
                target="_blank"
                className="text-xs font-medium text-brand-soft hover:underline"
              >
                View on the site ↗
              </Link>
            )}
          </div>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-fg">{event.title}</h1>
          <p className="text-sm text-muted">
            {shortDate(event.date)}
            {event.time ? ` · ${event.time}` : ""}
            {event.venue ? ` · ${event.venue}` : ""}
            {event.city ? `, ${event.city}` : ""}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link
            href={`/shreex/events/${event.id}/checkin`}
            className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-2 text-sm font-medium text-fg hover:border-brand hover:text-brand"
          >
            <Icon name="ticket" className="h-4 w-4" strokeWidth={1.8} />
            Door check-in
          </Link>
          {event.status !== "published" ? (
            <button
              onClick={() => move("published")}
              disabled={saving}
              className="rounded-full bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Publish
            </button>
          ) : (
            <button
              onClick={() => move("draft")}
              disabled={saving}
              className="rounded-full border border-line px-4 py-2 text-sm font-medium text-muted hover:text-fg disabled:opacity-50"
            >
              Unpublish
            </button>
          )}
          <button
            onClick={() => setEditing(true)}
            className="rounded-full border border-line px-4 py-2 text-sm font-medium text-fg hover:border-brand hover:text-brand"
          >
            Edit
          </button>
        </div>
      </div>

      {/* ── The numbers that matter on the day ── */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="Tickets sold"
          value={event.capacity > 0 ? `${stats.sold} / ${event.capacity}` : String(stats.sold)}
          sub={
            stats.remaining != null
              ? stats.remaining === 0
                ? "Sold out"
                : `${stats.remaining} left`
              : "No capacity set"
          }
          tone={stats.fill != null && stats.fill >= 0.9 ? "good" : "default"}
        />
        <KpiCard
          label="Checked in"
          value={String(stats.attended)}
          sub={stats.showRate != null ? `${pct(stats.showRate)} of those booked` : undefined}
        />
        <KpiCard label="Revenue" value={inr(revenue)} sub={event.price_label ?? undefined} />
        <KpiCard
          label="Waitlist"
          value={String(stats.waitlisted)}
          tone={stats.waitlisted > 0 ? "warn" : "default"}
          sub={stats.cancelled > 0 ? `${stats.cancelled} cancelled` : undefined}
        />
      </div>

      {/* ── Who is coming ── */}
      <Card className="!p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="font-display text-sm font-bold text-fg">
            Registrations{" "}
            <span className="font-normal text-faint">
              ({shown.length}
              {shown.length !== registrations.length ? ` of ${registrations.length}` : ""})
            </span>
          </h2>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, email or ticket code…"
            className="w-56 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-fg outline-none focus:border-brand"
          />
        </div>

        {registrations.length === 0 ? (
          <div className="p-5">
            <EmptyState title="Nobody yet" hint="Registrations show up here as they come in." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-faint">
                  <th className="px-5 py-2.5 font-semibold">Attendee</th>
                  <th className="px-3 py-2.5 font-semibold">Ticket</th>
                  <th className="px-3 py-2.5 font-semibold">Booked</th>
                  <th className="px-3 py-2.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="border-b border-line/60 last:border-0 hover:bg-surface-2">
                    <td className="px-5 py-2.5">
                      <p className="font-medium text-fg">{r.attendee_name || "—"}</p>
                      <p className="text-xs text-muted">{r.attendee_email}</p>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-muted">{r.ticket_code ?? "—"}</td>
                    <td className="px-3 py-2.5 text-xs text-muted">{shortDate(r.registered_at)}</td>
                    <td className="px-3 py-2.5">
                      {r.checked_in_at || r.status === "attended" ? (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700">
                          Checked in
                        </span>
                      ) : (
                        <span className="text-xs capitalize text-muted">{r.status}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <EventForm
        open={editing}
        onClose={() => setEditing(false)}
        event={event}
        owners={owners}
      />
    </>
  );
}
