"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import { toast } from "@/components/Toast";
import { KpiCard, EmptyState } from "@/components/os/ui";
import { Modal, Field, Input, Select, Textarea, FormActions } from "@/components/os/Modal";
import { shortDate } from "@/lib/bos";
import { saveContent, setContentStatus, setContentDate, deleteContent } from "@/lib/marketing-actions";

export type ContentItem = {
  id: string; content_date: string | null; platform: string | null;
  content_type: string | null; topic: string | null; pillar: string | null;
  campaign_id: string | null; audience: string | null; cta: string | null;
  owner_id: string | null; status: string; asset_url: string | null;
  reach: number | null; engagement: number | null; leads: number | null;
};

type Person = { id: string; full_name: string | null; email: string | null };

const STAGES = [
  { key: "not_started", label: "Idea", hint: "Nothing written yet" },
  { key: "in_progress", label: "Making", hint: "Being written or filmed" },
  { key: "blocked", label: "Blocked", hint: "Waiting on something" },
  { key: "completed", label: "Published", hint: "Out in the world" },
];

// Platforms are free text in the database, so colours are assigned by a stable
// hash of the name rather than a fixed map that goes stale the moment somebody
// types a new one.
const PLATFORM_HUES = ["#2a78d6", "#eb6834", "#1baf7a", "#4a3aa7", "#e87ba4", "#eda100"];
const hueFor = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PLATFORM_HUES[h % PLATFORM_HUES.length];
};

const iso = (d: Date) => {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 10);
};

/**
 * The content calendar, in the two views the work actually needs.
 *
 * A board answers "what state is everything in". A calendar answers "are we
 * posting evenly, or is Tuesday carrying the whole week" — which a board
 * physically cannot show, and which is the failure this kind of plan falls
 * into. Neither replaces the other, so both are here and the toggle keeps the
 * month you were looking at.
 */
export function ContentClient({
  items, campaigns, people,
}: { items: ContentItem[]; campaigns: { id: string; name: string }[]; people: Person[] }) {
  const [view, setView] = useState<"calendar" | "board">("calendar");
  const [editing, setEditing] = useState<ContentItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [platform, setPlatform] = useState("all");
  const [saving, start] = useTransition();
  const [dragOver, setDragOver] = useState<string | null>(null);

  const [rows, setRows] = useOptimistic(
    items,
    (state: ContentItem[], p: { id: string; status?: string; content_date?: string }) =>
      state.map((r) => (r.id === p.id ? { ...r, ...p } : r)),
  );

  const dated = rows.filter((r) => r.content_date);
  const months = useMemo(
    () => [...new Set(dated.map((r) => r.content_date!.slice(0, 7)))].sort(),
    [dated],
  );
  const [month, setMonth] = useState(() => {
    const now = iso(new Date()).slice(0, 7);
    return months.includes(now) ? now : months[0] ?? now;
  });

  const platforms = useMemo(
    () => [...new Set(rows.map((r) => r.platform).filter(Boolean) as string[])].sort(),
    [rows],
  );
  const shown = platform === "all" ? rows : rows.filter((r) => r.platform === platform);

  const nameOf = (id: string | null) => people.find((p) => p.id === id)?.full_name ?? "—";
  const campaignOf = (id: string | null) => campaigns.find((c) => c.id === id)?.name ?? null;

  // ── The spacing question the calendar exists to answer ──
  const rhythm = useMemo(() => {
    const inMonth = shown.filter((r) => r.content_date?.startsWith(month));
    const byDay = new Map<string, number>();
    for (const r of inMonth) byDay.set(r.content_date!, (byDay.get(r.content_date!) ?? 0) + 1);
    const counts = [...byDay.values()];
    const [y, m] = month.split("-").map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    return {
      planned: inMonth.length,
      daysUsed: byDay.size,
      busiest: counts.length ? Math.max(...counts) : 0,
      silent: daysInMonth - byDay.size,
    };
  }, [shown, month]);

  const move = (id: string, status: string) =>
    start(async () => {
      setRows({ id, status });
      const res = await setContentStatus(id, status);
      if ("error" in res && res.error) toast(res.error, "error");
    });

  const reschedule = (id: string, date: string) =>
    start(async () => {
      setRows({ id, content_date: date });
      const res = await setContentDate(id, date);
      if ("error" in res && res.error) toast(res.error, "error");
      else toast(`Moved to ${shortDate(date)}`, "success");
    });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg">Content calendar</h1>
          <p className="max-w-3xl text-sm text-muted">
            Everything planned, where it is going, and what state it is in. The calendar shows the
            rhythm; the board shows the work.
          </p>
        </div>
        <button onClick={() => setCreating(true)} className="shrink-0 rounded-full bg-brand px-4 py-2 text-sm font-medium text-white">
          + Plan a piece
        </button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label={`Planned in ${month}`} value={String(rhythm.planned)} />
        <KpiCard label="Days with something on" value={String(rhythm.daysUsed)} />
        <KpiCard label="Busiest day" value={rhythm.busiest ? `${rhythm.busiest} pieces` : "—"}
          tone={rhythm.busiest >= 4 ? "warn" : "default"}
          sub={rhythm.busiest >= 4 ? "stacked up" : undefined} />
        <KpiCard label="Quiet days" value={String(rhythm.silent)}
          tone={rhythm.silent > 20 ? "warn" : "default"} />
      </div>

      {/* ── Controls ── */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-full border border-line p-0.5">
          {(["calendar", "board"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${
                view === v ? "bg-brand text-white" : "text-muted hover:text-fg"}`}>
              {v}
            </button>
          ))}
        </div>
        {view === "calendar" && months.length > 0 && (
          <Select value={month} onChange={(e) => setMonth(e.target.value)} className="w-auto">
            {months.map((m) => <option key={m} value={m}>{m}</option>)}
          </Select>
        )}
        <button onClick={() => setPlatform("all")}
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            platform === "all" ? "bg-brand text-white" : "border border-line text-muted hover:text-fg"}`}>
          All platforms
        </button>
        {platforms.map((p) => (
          <button key={p} onClick={() => setPlatform(p)}
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
              platform === p ? "bg-brand text-white" : "border border-line text-muted hover:text-fg"}`}>
            <span className="h-2 w-2 rounded-full" style={{ background: hueFor(p) }} />
            {p}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState title="Nothing planned yet" hint="Plan the first piece and it appears on both views." />
      ) : view === "calendar" ? (
        <CalendarGrid
          month={month}
          items={shown.filter((r) => r.content_date?.startsWith(month))}
          hueFor={hueFor}
          onOpen={setEditing}
          onDrop={reschedule}
          dragOver={dragOver}
          setDragOver={setDragOver}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {STAGES.map((s) => {
            const list = shown.filter((r) => r.status === s.key);
            return (
              <section key={s.key}
                onDragOver={(e) => { e.preventDefault(); setDragOver(s.key); }}
                onDragLeave={() => setDragOver((d) => (d === s.key ? null : d))}
                onDrop={(e) => {
                  e.preventDefault(); setDragOver(null);
                  const id = e.dataTransfer.getData("text/plain");
                  if (id) move(id, s.key);
                }}
                className={`rounded-2xl border p-2.5 ${
                  dragOver === s.key ? "border-brand bg-brand/5" : "border-line bg-surface-2/40"}`}>
                <header className="mb-2 flex items-center gap-2 px-1">
                  <h2 className="flex-1 text-xs font-semibold uppercase tracking-wider text-fg">{s.label}</h2>
                  <span className="text-xs tabular-nums text-faint">{list.length}</span>
                </header>
                <div className="space-y-2">
                  {list.length === 0 ? (
                    <p className="px-1 py-3 text-center text-[11px] text-faint">{s.hint}</p>
                  ) : list.map((r) => (
                    <article key={r.id} draggable={!saving}
                      onDragStart={(e) => e.dataTransfer.setData("text/plain", r.id)}
                      onClick={() => setEditing(r)}
                      className="cursor-pointer rounded-xl border border-line bg-surface p-2.5 shadow-sm hover:shadow-md">
                      <div className="mb-1 flex items-center gap-1.5">
                        {r.platform && (
                          <span className="rounded-full px-1.5 py-0.5 text-[10px] font-medium text-white"
                            style={{ background: hueFor(r.platform) }}>{r.platform}</span>
                        )}
                        {r.content_date && <span className="text-[10px] text-faint">{shortDate(r.content_date)}</span>}
                      </div>
                      <p className="text-sm leading-snug text-fg">{r.topic ?? "Untitled"}</p>
                      <p className="mt-0.5 text-[11px] text-faint">
                        {nameOf(r.owner_id)}
                        {campaignOf(r.campaign_id) ? ` · ${campaignOf(r.campaign_id)}` : ""}
                      </p>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <ContentForm
        open={creating || !!editing}
        item={editing}
        campaigns={campaigns}
        people={people}
        onClose={() => { setCreating(false); setEditing(null); }}
      />
    </>
  );
}

// ─────────────────────────── The month grid ───────────────────────────

function CalendarGrid({
  month, items, hueFor, onOpen, onDrop, dragOver, setDragOver,
}: {
  month: string; items: ContentItem[]; hueFor: (s: string) => string;
  onOpen: (i: ContentItem) => void; onDrop: (id: string, date: string) => void;
  dragOver: string | null; setDragOver: (d: string | null) => void;
}) {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  // Monday first: a content week is a working week.
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(y, m, 0).getDate();
  const cells = Math.ceil((lead + days) / 7) * 7;

  const byDate = new Map<string, ContentItem[]>();
  for (const i of items) {
    const k = i.content_date!.slice(0, 10);
    if (!byDate.has(k)) byDate.set(k, []);
    byDate.get(k)!.push(i);
  }

  const today = iso(new Date());

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="grid grid-cols-7 border-b border-line bg-surface-2">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="px-2 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wider text-faint">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {Array.from({ length: cells }, (_, n) => {
          const dayNum = n - lead + 1;
          const inMonth = dayNum >= 1 && dayNum <= days;
          const key = inMonth ? `${month}-${String(dayNum).padStart(2, "0")}` : "";
          const list = inMonth ? byDate.get(key) ?? [] : [];
          return (
            <div key={n}
              onDragOver={(e) => { if (inMonth) { e.preventDefault(); setDragOver(key); } }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => {
                e.preventDefault(); setDragOver(null);
                const id = e.dataTransfer.getData("text/plain");
                if (id && inMonth) onDrop(id, key);
              }}
              className={`min-h-[6.5rem] border-b border-r border-line/70 p-1.5 ${
                !inMonth ? "bg-surface-2/40" : dragOver === key ? "bg-brand/5" : ""}`}>
              {inMonth && (
                <>
                  <span className={`mb-1 inline-grid h-5 w-5 place-items-center rounded-full text-[11px] tabular-nums ${
                    key === today ? "bg-brand font-bold text-white" : "text-faint"}`}>
                    {dayNum}
                  </span>
                  <div className="space-y-1">
                    {list.slice(0, 3).map((i) => (
                      <button key={i.id} draggable
                        onDragStart={(e) => e.dataTransfer.setData("text/plain", i.id)}
                        onClick={() => onOpen(i)}
                        className="block w-full rounded border-l-[3px] bg-surface-2 px-1.5 py-1 text-left text-[10px] leading-tight text-fg hover:opacity-80"
                        style={{ borderColor: i.platform ? hueFor(i.platform) : "#999" }}>
                        <span className="line-clamp-2">{i.topic ?? "Untitled"}</span>
                      </button>
                    ))}
                    {list.length > 3 && (
                      <span className="block px-1.5 text-[10px] text-faint">+{list.length - 3} more</span>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────── The form ───────────────────────────────

function ContentForm({
  open, item, campaigns, people, onClose,
}: {
  open: boolean; item: ContentItem | null;
  campaigns: { id: string; name: string }[]; people: Person[]; onClose: () => void;
}) {
  const [saving, start] = useTransition();
  const [form, setForm] = useState(() => ({
    topic: item?.topic ?? "", content_date: item?.content_date?.slice(0, 10) ?? "",
    platform: item?.platform ?? "", content_type: item?.content_type ?? "",
    pillar: item?.pillar ?? "", audience: item?.audience ?? "", cta: item?.cta ?? "",
    campaign_id: item?.campaign_id ?? "", owner_id: item?.owner_id ?? "",
    status: item?.status ?? "not_started", asset_url: item?.asset_url ?? "",
    reach: item?.reach != null ? String(item.reach) : "",
    engagement: item?.engagement != null ? String(item.engagement) : "",
    leads: item?.leads != null ? String(item.leads) : "",
  }));
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const published = form.status === "completed";

  return (
    <Modal open={open} onClose={onClose} title={item ? "Edit this piece" : "Plan a piece"} wide>
      <form onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await saveContent(item?.id ?? null, {
            ...form,
            reach: form.reach === "" ? null : form.reach,
            engagement: form.engagement === "" ? null : form.engagement,
            leads: form.leads === "" ? null : form.leads,
          });
          if ("error" in res && res.error) toast(res.error, "error");
          else { toast("Saved", "success"); onClose(); }
        });
      }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="What is it about"><Input value={form.topic} onChange={(e) => set("topic", e.target.value)} required /></Field>
          </div>
          <Field label="Goes out on"><Input type="date" value={form.content_date} onChange={(e) => set("content_date", e.target.value)} /></Field>
          <Field label="Platform"><Input value={form.platform} onChange={(e) => set("platform", e.target.value)} placeholder="LinkedIn" /></Field>
          <Field label="Format"><Input value={form.content_type} onChange={(e) => set("content_type", e.target.value)} placeholder="Carousel" /></Field>
          <Field label="Pillar"><Input value={form.pillar} onChange={(e) => set("pillar", e.target.value)} placeholder="Community" /></Field>
          <Field label="Stage">
            <Select value={form.status} onChange={(e) => set("status", e.target.value)}>
              {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </Select>
          </Field>
          <Field label="Who is making it">
            <Select value={form.owner_id} onChange={(e) => set("owner_id", e.target.value)}>
              <option value="">Nobody</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
            </Select>
          </Field>
          <Field label="Part of a campaign">
            <Select value={form.campaign_id} onChange={(e) => set("campaign_id", e.target.value)}>
              <option value="">On its own</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Call to action"><Input value={form.cta} onChange={(e) => set("cta", e.target.value)} /></Field>
          <div className="sm:col-span-2">
            <Field label="Who it is for"><Textarea rows={2} value={form.audience} onChange={(e) => set("audience", e.target.value)} /></Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Link to the asset"><Input value={form.asset_url} onChange={(e) => set("asset_url", e.target.value)} /></Field>
          </div>

          {published && (
            <>
              <Field label="Reach"><Input type="number" min={0} value={form.reach} onChange={(e) => set("reach", e.target.value)} /></Field>
              <Field label="Engagement"><Input type="number" min={0} value={form.engagement} onChange={(e) => set("engagement", e.target.value)} /></Field>
              <Field label="Leads"><Input type="number" min={0} value={form.leads} onChange={(e) => set("leads", e.target.value)} /></Field>
            </>
          )}
        </div>

        {!published && (
          <p className="mt-3 text-xs text-faint">
            Reach and engagement appear once this is marked published — there is nothing to record
            before it goes out.
          </p>
        )}

        <div className="mt-3 flex items-center justify-between gap-3">
          {item ? (
            <button type="button"
              onClick={() => start(async () => {
                const res = await deleteContent(item.id);
                if ("error" in res && res.error) toast(res.error, "error");
                else { toast("Removed", "success"); onClose(); }
              })}
              className="text-xs font-medium text-red-600 hover:underline">Remove</button>
          ) : <span />}
          <FormActions onCancel={onClose} saving={saving} submitLabel="Save" />
        </div>
      </form>
    </Modal>
  );
}
