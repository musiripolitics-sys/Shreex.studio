"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icon";

export type CalItem = {
  date: string;
  type: string;
  label: string;
  href: string;
};

/**
 * Every entry type, with a colour AND an icon.
 *
 * Research on dense calendars is blunt about this: a category that exists only
 * as a hue is invisible to a meaningful share of readers, so colour never
 * carries a distinction on its own here.
 */
export const TYPES: Record<string, { color: string; bg: string; icon: string; short: string }> = {
  "Task due":      { color: "#2563eb", bg: "#eff6ff", icon: "check",    short: "Due" },
  "Task overdue":  { color: "#dc2626", bg: "#fef2f2", icon: "bell",     short: "Late" },
  "Task done":     { color: "#16a34a", bg: "#f0fdf4", icon: "check",    short: "Done" },
  "Goal":          { color: "#7c3aed", bg: "#f5f3ff", icon: "rocket",   short: "Goal" },
  "Event":         { color: "#ea580c", bg: "#fff7ed", icon: "calendar", short: "Event" },
  "Campaign":      { color: "#db2777", bg: "#fdf2f8", icon: "broadcast",short: "Campaign" },
  "Content":       { color: "#9333ea", bg: "#faf5ff", icon: "book",     short: "Content" },
  "Podcast":       { color: "#0891b2", bg: "#ecfeff", icon: "mic",      short: "Podcast" },
  "Hiring":        { color: "#c026d3", bg: "#fdf4ff", icon: "users",    short: "Hiring" },
  "Legal due":     { color: "#475569", bg: "#f8fafc", icon: "book",     short: "Legal" },
  "Legal expiry":  { color: "#dc2626", bg: "#fef2f2", icon: "clock",    short: "Expiry" },
};
const fallback = { color: "#64748b", bg: "#f8fafc", icon: "tag", short: "Other" };
const styleOf = (t: string) => TYPES[t] ?? fallback;

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * The business calendar as a grid.
 *
 * It used to be a list of dated rows, which wasted most of the width and made
 * "what does that week look like" unanswerable. A month fits on one screen
 * here; a cell shows three entries and counts the rest, and clicking any day
 * opens everything on it.
 */
export function CalendarView({ items, months }: { items: CalItem[]; months: string[] }) {
  const today = iso(new Date());
  const firstWithData = months[0] ?? today.slice(0, 7);
  const [view, setView] = useState<"month" | "week">("month");
  const [cursor, setCursor] = useState(() =>
    months.includes(today.slice(0, 7)) ? today.slice(0, 7) : firstWithData,
  );
  // Week mode needs a day, not a month: the Monday of the week on show.
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return iso(d);
  });
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const visible = useMemo(
    () => items.filter((i) => !hidden.has(i.type)),
    [items, hidden],
  );
  const byDate = useMemo(() => {
    const m = new Map<string, CalItem[]>();
    for (const i of visible) m.set(i.date, [...(m.get(i.date) ?? []), i]);
    return m;
  }, [visible]);

  // Weeks start Monday, which is how a working calendar is read.
  const [y, mo] = cursor.split("-").map(Number);
  const first = new Date(y, mo - 1, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const gridStart = new Date(y, mo - 1, 1 - startOffset);
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
  // A sixth row is only drawn when the month actually needs one.
  const rows = cells[35] && cells[35].getMonth() === mo - 1 ? 6 : 5;

  const shift = (n: number) => {
    if (view === "week") {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + n * 7);
      setWeekStart(iso(d));
      return;
    }
    const d = new Date(y, mo - 1 + n, 1);
    setCursor(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  const jumpToToday = () => {
    const d = new Date();
    setCursor(today.slice(0, 7));
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    setWeekStart(iso(d));
  };

  const switchTo = (v: "month" | "week") => {
    if (v === view) return;
    if (v === "week") {
      // Land on the week the month view was showing: this week if it falls in
      // that month, otherwise the month's first week.
      const inMonth = today.slice(0, 7) === cursor;
      const d = inMonth ? new Date() : new Date(y, mo - 1, 1);
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      setWeekStart(iso(d));
    } else {
      // A week can straddle two months; the one holding the Thursday is the
      // week's month by ISO reckoning, and the one a reader means.
      const thu = new Date(weekStart);
      thu.setDate(thu.getDate() + 3);
      setCursor(`${thu.getFullYear()}-${String(thu.getMonth() + 1).padStart(2, "0")}`);
    }
    setView(v);
  };

  // The seven days of the week on show.
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
  const weekTitle = `${weekDays[0].toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – ${weekDays[6].toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`;

  const monthName = first.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const inMonth = (d: Date) => d.getMonth() === mo - 1;
  const present = [...new Set(items.map((i) => i.type))].sort();
  const dayItems = openDay ? (byDate.get(openDay) ?? []) : [];

  return (
    <>
      {/* ── Controls ── */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button onClick={() => shift(-1)} aria-label="Previous month"
            className="grid h-8 w-8 place-items-center rounded-lg border border-line text-muted hover:border-brand hover:text-brand">
            ‹
          </button>
          <h2 className="min-w-[13rem] px-2 text-center font-display text-base font-bold text-fg">
            {view === "week" ? weekTitle : monthName}
          </h2>
          <button onClick={() => shift(1)} aria-label="Next month"
            className="grid h-8 w-8 place-items-center rounded-lg border border-line text-muted hover:border-brand hover:text-brand">
            ›
          </button>
          <button onClick={jumpToToday}
            className="ml-2 rounded-full border border-line px-3 py-1 text-xs font-medium text-muted hover:border-brand hover:text-brand">
            Today
          </button>
          <div className="ml-2 flex rounded-full border border-line p-0.5">
            {(["month", "week"] as const).map((v) => (
              <button
                key={v}
                onClick={() => switchTo(v)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium capitalize transition-colors ${
                  view === v ? "bg-brand text-white" : "text-muted hover:text-fg"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {/* Legend doubles as a filter — the quickest way to cut density. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {present.map((t) => {
            const s = styleOf(t);
            const off = hidden.has(t);
            return (
              <button
                key={t}
                onClick={() =>
                  setHidden((h) => {
                    const n = new Set(h);
                    if (n.has(t)) n.delete(t);
                    else n.add(t);
                    return n;
                  })
                }
                title={off ? `Show ${t}` : `Hide ${t}`}
                className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition-opacity ${
                  off ? "border-line text-faint opacity-50" : "border-line text-muted"
                }`}
                style={off ? undefined : { background: s.bg, borderColor: s.color + "40", color: s.color }}
              >
                <Icon name={s.icon} className="h-3 w-3" strokeWidth={2} />
                {t}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Week: taller columns, nothing hidden behind a "+N more" ── */}
      {view === "week" ? (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <div className="grid min-w-[56rem] grid-cols-7">
            {weekDays.map((d) => {
              const key = iso(d);
              const list = byDate.get(key) ?? [];
              const isToday = key === today;
              return (
                <div key={key} className="min-h-[24rem] border-r border-line/70 last:border-r-0">
                  <div
                    className={`border-b border-line px-2 py-2 text-center ${
                      isToday ? "bg-brand/10" : "bg-surface-2"
                    }`}
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-faint">
                      {d.toLocaleDateString("en-IN", { weekday: "short" })}
                    </p>
                    <p
                      className={`mx-auto mt-0.5 grid h-6 w-6 place-items-center rounded-full text-sm tabular-nums ${
                        isToday ? "bg-brand font-bold text-white" : "font-semibold text-fg"
                      }`}
                    >
                      {d.getDate()}
                    </p>
                  </div>
                  <div className="space-y-1.5 p-1.5">
                    {list.length === 0 ? (
                      <p className="px-1 py-4 text-center text-[10px] text-faint">—</p>
                    ) : (
                      list.map((it, n) => {
                        const st = styleOf(it.type);
                        return (
                          <Link
                            key={n}
                            href={it.href}
                            className="block rounded-lg border-l-[3px] p-1.5 transition-opacity hover:opacity-80"
                            style={{ background: st.bg, borderColor: st.color }}
                          >
                            <span
                              className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide"
                              style={{ color: st.color }}
                            >
                              <Icon name={st.icon} className="h-2.5 w-2.5" strokeWidth={2.4} />
                              {st.short}
                            </span>
                            <span className="mt-0.5 block text-[11px] leading-snug text-fg">
                              {it.label}
                            </span>
                          </Link>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="grid grid-cols-7 border-b border-line bg-surface-2">
          {WEEKDAYS.map((d) => (
            <div key={d} className="px-2 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wider text-faint">
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {cells.slice(0, rows * 7).map((d, i) => {
            const key = iso(d);
            const list = byDate.get(key) ?? [];
            const isToday = key === today;
            const out = !inMonth(d);
            return (
              <button
                key={key}
                onClick={() => list.length > 0 && setOpenDay(key)}
                className={`min-h-[6.5rem] border-b border-r border-line/70 p-1.5 text-left align-top transition-colors last:border-r-0 ${
                  out ? "bg-ink/30" : "bg-surface hover:bg-surface-2"
                } ${i % 7 === 6 ? "border-r-0" : ""}`}
              >
                <span
                  className={`mb-1 inline-grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] tabular-nums ${
                    isToday
                      ? "bg-brand font-bold text-white"
                      : out
                        ? "text-faint"
                        : "font-medium text-muted"
                  }`}
                >
                  {d.getDate()}
                </span>

                <span className="block space-y-0.5">
                  {list.slice(0, 3).map((it, n) => {
                    const s = styleOf(it.type);
                    return (
                      <span
                        key={n}
                        title={`${it.type}: ${it.label}`}
                        className="flex items-center gap-1 rounded px-1 py-0.5 text-[10px] leading-tight"
                        style={{ background: s.bg, color: s.color }}
                      >
                        <Icon name={s.icon} className="h-2.5 w-2.5 shrink-0" strokeWidth={2.4} />
                        <span className="truncate">{it.label}</span>
                      </span>
                    );
                  })}
                  {list.length > 3 && (
                    <span className="block px-1 text-[10px] font-medium text-brand-soft">
                      +{list.length - 3} more
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      )}

      {/* ── A day, in full ── */}
      {openDay && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <button aria-label="Close" onClick={() => setOpenDay(null)}
            className="absolute inset-0 cursor-default bg-black/40 backdrop-blur-sm" />
          <div role="dialog" aria-modal="true"
            className="relative max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-surface shadow-soft">
            <div className="sticky top-0 flex items-center justify-between border-b border-line bg-surface px-5 py-3">
              <h3 className="font-display text-sm font-bold text-fg">
                {new Date(openDay).toLocaleDateString("en-IN", {
                  weekday: "long", day: "numeric", month: "long", year: "numeric",
                })}
              </h3>
              <button onClick={() => setOpenDay(null)} className="text-sm text-faint hover:text-fg">
                Close
              </button>
            </div>
            <div className="divide-y divide-line">
              {dayItems.map((it, n) => {
                const s = styleOf(it.type);
                return (
                  <Link key={n} href={it.href}
                    className="flex items-start gap-2.5 px-5 py-3 hover:bg-surface-2">
                    <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg"
                      style={{ background: s.bg, color: s.color }}>
                      <Icon name={s.icon} className="h-3.5 w-3.5" strokeWidth={2} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[10px] font-semibold uppercase tracking-wide"
                        style={{ color: s.color }}>
                        {it.type}
                      </span>
                      <span className="block text-sm text-fg">{it.label}</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
