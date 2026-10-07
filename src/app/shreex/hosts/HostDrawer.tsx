"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "@/components/Toast";
import { useDialogChrome } from "@/components/os/useDialogChrome";
import { Field, Input, Select, Textarea } from "@/components/os/Modal";
import { shortDate } from "@/lib/bos";
import { addHostNote, sendHostEmail, updateHostRequest } from "./actions";
import { STAGES, type HostRequest, type HostMessage, type Stage, type Template } from "./HostPipeline";

/**
 * Fill a template out from the request it is about.
 *
 * sender used to be the string "the Techxfluence team", hardcoded. That is one
 * tenant name sitting in platform code: the same drawer, opened by a Jilo
 * administrator, signed their email as somebody else company. It comes from
 * the business now, and falls back to something nobody has to disown.
 */
function fill(text: string, r: HostRequest, sender?: string) {
  return text
    .replaceAll("{{name}}", (r.organizer_name ?? "there").split(" ")[0])
    .replaceAll("{{event}}", r.title ?? "your event")
    .replaceAll("{{date}}", r.date ? shortDate(r.date) : "the date you suggested")
    .replaceAll("{{city}}", r.city ?? "your city")
    .replaceAll("{{sender}}", sender?.trim() ? `the ${sender.trim()} team` : "the team");
}

const KIND_LABEL: Record<string, string> = {
  note: "Note", email: "Email sent", stage: "Moved", call: "Call",
};

/**
 * One request, opened.
 *
 * Everything the proposer told us, everything anybody has said since, and the
 * ability to write to them without leaving — because the moment a reply is
 * written in a personal inbox instead, the thread here stops being the record
 * of what happened.
 */
export function HostDrawer({
  request,
  messages,
  templates,
  owners,
  events,
  onClose,
  onStage,
  businessName,
}: {
  request: HostRequest;
  messages: HostMessage[];
  templates: Template[];
  owners: { id: string; full_name: string | null; email: string | null }[];
  events: { id: string; title: string; date: string }[];
  onClose: () => void;
  onStage: (stage: Stage) => void;
  /** Signs the outgoing email. Comes from the business, not from this file. */
  businessName?: string;
}) {
  useDialogChrome(true, onClose);
  const [saving, start] = useTransition();
  const [tab, setTab] = useState<"thread" | "write">("thread");
  const [note, setNote] = useState("");
  const [to, setTo] = useState(request.organizer_email ?? "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [picked, setPicked] = useState("");

  const run = (fn: () => Promise<{ error?: string } | { success: boolean }>, ok: string) =>
    start(async () => {
      const res = await fn();
      if (res && "error" in res && res.error) toast(res.error, "error");
      else toast(ok, "success");
    });

  const applyTemplate = (id: string) => {
    setPicked(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    // Filled in, then editable: a template nobody adjusts reads like a form
    // letter, which is worse than not sending one.
    setSubject(fill(t.subject, request, businessName));
    setBody(fill(t.body, request, businessName));
  };

  const field = "w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-fg outline-none focus:border-brand";

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto overscroll-contain p-4 sm:p-8">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex min-h-full items-center justify-center">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={request.title ?? "Host request"}
          className="w-full max-w-4xl overflow-hidden rounded-2xl border border-line bg-surface shadow-soft"
        >
          {/* ── Header ── */}
          <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-faint">
                Proposed {request.submitted_at ? shortDate(request.submitted_at) : "—"}
                {request.city ? ` · ${request.city}` : ""}
              </p>
              <h3 className="mt-0.5 font-display text-lg font-bold text-fg">
                {request.title ?? "Untitled proposal"}
              </h3>
              <p className="text-sm text-muted">
                {request.organizer_name ?? "Unknown"}
                {request.organizer_email ? ` · ${request.organizer_email}` : ""}
              </p>
            </div>
            <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-ink-2 hover:text-fg">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <div className="grid md:grid-cols-[1.35fr_1fr]">
            {/* ── Left: the conversation ── */}
            <div className="border-b border-line p-5 md:border-b-0 md:border-r">
              <div className="mb-3 flex gap-2">
                {(["thread", "write"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                      tab === t ? "bg-brand text-white" : "border border-line text-muted hover:text-fg"
                    }`}
                  >
                    {t === "thread" ? `History (${messages.length})` : "Write to them"}
                  </button>
                ))}
              </div>

              {tab === "thread" ? (
                <>
                  <ul className="mb-3 max-h-80 space-y-2 overflow-y-auto pr-1">
                    {messages.length === 0 && (
                      <li className="text-xs text-faint">
                        Nothing yet. What the proposer wrote is on the right.
                      </li>
                    )}
                    {messages.map((m) => (
                      <li key={m.id} className="rounded-lg border border-line bg-surface-2/50 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wider text-faint">
                          {KIND_LABEL[m.kind] ?? m.kind} · {m.author_name ?? "Someone"} ·{" "}
                          {shortDate(m.created_at)}
                          {m.to_email ? ` · to ${m.to_email}` : ""}
                        </p>
                        {m.subject && <p className="mt-0.5 text-xs font-semibold text-fg">{m.subject}</p>}
                        <p className="whitespace-pre-wrap text-xs text-fg">{m.body}</p>
                      </li>
                    ))}
                  </ul>

                  <Textarea
                    rows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Add a note — what was said on the call, what we decided…"
                  />
                  <button
                    disabled={saving || !note.trim()}
                    onClick={() =>
                      run(async () => {
                        const r = await addHostNote(request.id, note);
                        if (!("error" in r)) setNote("");
                        return r;
                      }, "Note added")
                    }
                    className="mt-2 rounded-full bg-brand px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                  >
                    Add note
                  </button>
                </>
              ) : (
                <div className="space-y-2.5">
                  <Field label="Start from a template">
                    <Select value={picked} onChange={(e) => applyTemplate(e.target.value)}>
                      <option value="">Write it myself</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </Select>
                  </Field>
                  {picked && (
                    <p className="text-[11px] text-faint">
                      {templates.find((t) => t.id === picked)?.purpose}
                    </p>
                  )}
                  <Field label="To">
                    <Input value={to} onChange={(e) => setTo(e.target.value)} type="email" />
                  </Field>
                  <Field label="Subject">
                    <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
                  </Field>
                  <Field label="Message">
                    <Textarea rows={11} value={body} onChange={(e) => setBody(e.target.value)} />
                  </Field>
                  <button
                    disabled={saving || !to.trim() || !subject.trim() || !body.trim()}
                    onClick={() =>
                      run(async () => {
                        const r = await sendHostEmail(request.id, { to, subject, body });
                        if (!("error" in r)) {
                          setSubject("");
                          setBody("");
                          setPicked("");
                          setTab("thread");
                        }
                        return r;
                      }, "Sent, and saved to the thread")
                    }
                    className="w-full rounded-full bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                  >
                    Send
                  </button>
                  <p className="text-[11px] text-faint">
                    Every send is kept in the history above, so the next person to pick this up
                    can see what was already said.
                  </p>
                </div>
              )}
            </div>

            {/* ── Right: the facts and the handles ── */}
            <aside className="space-y-4 bg-surface-2/40 p-5">
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">Stage</p>
                <Select value={request.stage} onChange={(e) => onStage(e.target.value as Stage)} className={field}>
                  {STAGES.map((s) => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </Select>
              </div>

              <Field label="Owner">
                <Select
                  value={request.owner_id ?? ""}
                  onChange={(e) =>
                    run(() => updateHostRequest(request.id, { owner_id: e.target.value }), "Owner set")
                  }
                >
                  <option value="">Nobody</option>
                  {owners.map((o) => (
                    <option key={o.id} value={o.id}>{o.full_name || o.email}</option>
                  ))}
                </Select>
              </Field>

              <Field label="The event this became">
                <Select
                  value={request.event_id ?? ""}
                  onChange={(e) =>
                    run(() => updateHostRequest(request.id, { event_id: e.target.value }), "Linked")
                  }
                >
                  <option value="">Not created yet</option>
                  {events.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.title} · {shortDate(ev.date)}
                    </option>
                  ))}
                </Select>
              </Field>
              {request.event_id && (
                <Link
                  href={`/shreex/events/${request.event_id}`}
                  className="-mt-2 block text-[11px] font-medium text-brand-soft hover:underline"
                >
                  Open the event →
                </Link>
              )}

              <Field label="Next step">
                <Input
                  defaultValue={request.next_step ?? ""}
                  onBlur={(e) =>
                    e.target.value !== (request.next_step ?? "") &&
                    run(() => updateHostRequest(request.id, { next_step: e.target.value }), "Saved")
                  }
                  placeholder="Call them about the venue"
                />
              </Field>
              <Field label="By when">
                <Input
                  type="date"
                  defaultValue={request.next_step_on?.slice(0, 10) ?? ""}
                  onChange={(e) =>
                    run(() => updateHostRequest(request.id, { next_step_on: e.target.value }), "Saved")
                  }
                />
              </Field>

              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
                  What they proposed
                </p>
                <dl className="space-y-1 text-xs">
                  <div><dt className="inline text-faint">Category: </dt><dd className="inline text-fg">{request.category ?? "—"}</dd></div>
                  <div><dt className="inline text-faint">Date: </dt><dd className="inline text-fg">{request.date ? shortDate(request.date) : "—"}</dd></div>
                  <div><dt className="inline text-faint">Venue: </dt><dd className="inline text-fg">{request.venue ?? "—"}</dd></div>
                </dl>
                {request.description && (
                  <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-surface px-2.5 py-2 text-xs text-muted">
                    {request.description}
                  </p>
                )}
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}
