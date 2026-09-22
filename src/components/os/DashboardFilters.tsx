"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback } from "react";

/**
 * Executive-dashboard filters. Writes from/to/preset/owner/workstream to the
 * URL so the Server Component re-queries. Owner + workstream scope the
 * operational sections (tasks, goals, campaigns, leads, expenses).
 */
export function DashboardFilters({
  from,
  to,
  preset,
  owner,
  workstream,
  owners,
  workstreams,
}: {
  from: string;
  to: string;
  preset: string;
  owner: string;
  workstream: string;
  owners: { id: string; full_name: string | null; email: string | null }[];
  workstreams: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const push = useCallback(
    (next: Record<string, string | null>) => {
      const sp = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v == null || v === "") sp.delete(k);
        else sp.set(k, v);
      }
      router.push(`${pathname}?${sp.toString()}`);
    },
    [params, pathname, router],
  );

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const today = new Date();

  const applyPreset = (p: string) => {
    const y = today.getFullYear();
    const m = today.getMonth();
    if (p === "month") push({ preset: p, from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) });
    else if (p === "quarter") {
      const q = Math.floor(m / 3) * 3;
      push({ preset: p, from: iso(new Date(y, q, 1)), to: iso(new Date(y, q + 3, 0)) });
    } else if (p === "year") push({ preset: p, from: iso(new Date(y, 0, 1)), to: iso(new Date(y, 11, 31)) });
  };

  const presets = [
    { key: "month", label: "This month" },
    { key: "quarter", label: "This quarter" },
    { key: "year", label: "This year" },
  ];
  const ctrl = "rounded-lg border border-line bg-surface px-2 py-1 text-xs text-fg outline-none focus:border-brand";

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      <div className="flex rounded-full border border-line bg-surface p-0.5">
        {presets.map((p) => (
          <button
            key={p.key}
            onClick={() => applyPreset(p.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              preset === p.key ? "bg-brand text-white" : "text-muted hover:text-fg"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <input type="date" value={from} onChange={(e) => push({ from: e.target.value, preset: "custom" })} className={ctrl} aria-label="From date" />
        <span>→</span>
        <input type="date" value={to} onChange={(e) => push({ to: e.target.value, preset: "custom" })} className={ctrl} aria-label="To date" />
      </div>
      <select value={workstream} onChange={(e) => push({ workstream: e.target.value })} className={ctrl} aria-label="Workstream">
        <option value="">All workstreams</option>
        {workstreams.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
      <select value={owner} onChange={(e) => push({ owner: e.target.value })} className={ctrl} aria-label="Owner">
        <option value="">All owners</option>
        {owners.map((o) => <option key={o.id} value={o.id}>{o.full_name || o.email}</option>)}
      </select>
    </div>
  );
}
