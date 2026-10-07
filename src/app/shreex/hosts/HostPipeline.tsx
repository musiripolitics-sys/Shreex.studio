"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import { toast } from "@/components/Toast";
import { EmptyState } from "@/components/os/ui";
import { shortDate } from "@/lib/bos";
import { setHostStage } from "./actions";
import { HostDrawer } from "./HostDrawer";

export type HostRequest = {
  id: string;
  title: string | null;
  category: string | null;
  date: string | null;
  city: string | null;
  venue: string | null;
  description: string | null;
  organizer_email: string | null;
  organizer_id: string | null;
  organizer_name: string | null;
  status: string | null;
  stage: Stage;
  owner_id: string | null;
  event_id: string | null;
  next_step: string | null;
  next_step_on: string | null;
  stage_changed_at: string | null;
  submitted_at: string | null;
};

export type HostMessage = {
  id: string;
  submission_id: string;
  author_id: string | null;
  author_name: string | null;
  kind: string;
  subject: string | null;
  body: string;
  to_email: string | null;
  created_at: string;
};

export type Template = {
  id: string; name: string; purpose: string | null;
  subject: string; body: string; stage: string | null;
};

export type Stage = "new" | "qualifying" | "proposed" | "scheduled" | "running" | "done" | "declined";

const STAGES: { key: Stage; label: string; hint: string; accent: string }[] = [
  { key: "new", label: "New", hint: "Just arrived", accent: "bg-blue-500" },
  { key: "qualifying", label: "Qualifying", hint: "Finding out if it fits", accent: "bg-indigo-500" },
  { key: "proposed", label: "Proposed", hint: "Waiting on them", accent: "bg-amber-500" },
  { key: "scheduled", label: "Scheduled", hint: "Date agreed", accent: "bg-teal-500" },
  { key: "running", label: "Running", hint: "Happening now", accent: "bg-green-500" },
  { key: "done", label: "Done", hint: "Delivered", accent: "bg-neutral-400" },
  { key: "declined", label: "Declined", hint: "Not this time", accent: "bg-red-400" },
];

const daysSince = (iso: string | null) =>
  iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null;

/**
 * Every host request, as a board.
 *
 * The research on pipelines is consistent about two things: a board is read
 * far faster than a list because position carries meaning, and a pipeline
 * with too many columns stops being updated. Seven stages, one card per
 * request, and the thing that actually matters on a card — how long it has
 * been sitting there without anybody touching it.
 */
export function HostPipeline({
  requests,
  messages,
  templates,
  owners,
  events,
  businessName,
}: {
  requests: HostRequest[];
  messages: HostMessage[];
  templates: Template[];
  owners: { id: string; full_name: string | null; email: string | null }[];
  events: { id: string; title: string; date: string }[];
  businessName?: string;
}) {
  const [saving, start] = useTransition();
  const [openId, setOpenId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<Stage | null>(null);

  const [moved, setMoved] = useOptimistic(
    requests,
    (state: HostRequest[], patch: { id: string; stage: Stage }) =>
      state.map((r) => (r.id === patch.id ? { ...r, stage: patch.stage } : r)),
  );

  const open = openId ? moved.find((r) => r.id === openId) ?? null : null;

  const move = (id: string, stage: Stage) => {
    const r = moved.find((x) => x.id === id);
    if (!r || r.stage === stage) return;
    start(async () => {
      setMoved({ id, stage });
      const res = await setHostStage(id, stage);
      if ("error" in res && res.error) toast(res.error, "error");
    });
  };

  const byStage = useMemo(() => {
    const m = new Map<Stage, HostRequest[]>();
    for (const s of STAGES) m.set(s.key, []);
    for (const r of moved) m.get(r.stage)?.push(r);
    return m;
  }, [moved]);

  const live = moved.filter((r) => r.stage !== "done" && r.stage !== "declined").length;

  if (requests.length === 0) {
    return (
      <EmptyState
        title="No host requests yet"
        hint="Proposals from the Host an event form land here, and you work them from left to right."
      />
    );
  }

  return (
    <>
      <p className="mb-3 text-xs text-faint">
        {live} open {live === 1 ? "request" : "requests"} · drag a card to move it, or open one to
        write to them
      </p>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {STAGES.map((s) => {
          const list = byStage.get(s.key) ?? [];
          return (
            <section
              key={s.key}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(s.key);
              }}
              onDragLeave={() => setDragOver((d) => (d === s.key ? null : d))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                const id = e.dataTransfer.getData("text/plain");
                if (id) move(id, s.key);
              }}
              className={`rounded-2xl border p-2.5 transition-colors ${
                dragOver === s.key ? "border-brand bg-brand/5" : "border-line bg-surface-2/40"
              }`}
            >
              <header className="mb-2 flex items-center gap-2 px-1">
                <span className={`h-2 w-2 shrink-0 rounded-full ${s.accent}`} />
                <h2 className="flex-1 text-xs font-semibold uppercase tracking-wider text-fg">
                  {s.label}
                </h2>
                <span className="text-xs tabular-nums text-faint">{list.length}</span>
              </header>

              <div className="space-y-2">
                {list.length === 0 ? (
                  <p className="px-1 py-3 text-center text-[11px] text-faint">{s.hint}</p>
                ) : (
                  list.map((r) => {
                    const stale = daysSince(r.stage_changed_at);
                    const idle = stale != null && stale >= 7 && r.stage !== "done" && r.stage !== "declined";
                    return (
                      <article
                        key={r.id}
                        draggable={!saving}
                        onDragStart={(e) => e.dataTransfer.setData("text/plain", r.id)}
                        onClick={() => setOpenId(r.id)}
                        className="cursor-pointer rounded-xl border border-line bg-surface p-2.5 shadow-sm transition-shadow hover:shadow-md"
                      >
                        <p className="text-sm font-medium leading-snug text-fg">
                          {r.title ?? "Untitled proposal"}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] text-muted">
                          {r.organizer_name ?? r.organizer_email ?? "Unknown"}
                          {r.city ? ` · ${r.city}` : ""}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {r.date && (
                            <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">
                              {shortDate(r.date)}
                            </span>
                          )}
                          {r.event_id && (
                            <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">
                              Event created
                            </span>
                          )}
                          {idle && (
                            <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                              {stale}d untouched
                            </span>
                          )}
                        </div>
                        {r.next_step && (
                          <p className="mt-1.5 truncate text-[11px] text-faint">Next: {r.next_step}</p>
                        )}
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          );
        })}
      </div>

      {open && (
        <HostDrawer
          businessName={businessName}
          key={open.id}
          request={open}
          messages={messages.filter((m) => m.submission_id === open.id)}
          templates={templates}
          owners={owners}
          events={events}
          onClose={() => setOpenId(null)}
          onStage={(stage) => move(open.id, stage)}
        />
      )}
    </>
  );
}

export { STAGES };
