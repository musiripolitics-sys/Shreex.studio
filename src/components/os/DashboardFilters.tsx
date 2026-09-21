"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback } from "react";

/**
 * Date-range filter for the executive dashboard. Writes `from`/`to`/`preset`
 * to the URL so the Server Component re-queries. Presets cover the ranges the
 * spec asks for (month / quarter / year), plus a custom range.
 */
export function DashboardFilters({
  from,
  to,
  preset,
}: {
  from: string;
  to: string;
  preset: string;
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
    if (p === "month") {
      push({ preset: p, from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) });
    } else if (p === "quarter") {
      const qStart = Math.floor(m / 3) * 3;
      push({ preset: p, from: iso(new Date(y, qStart, 1)), to: iso(new Date(y, qStart + 3, 0)) });
    } else if (p === "year") {
      push({ preset: p, from: iso(new Date(y, 0, 1)), to: iso(new Date(y, 11, 31)) });
    }
  };

  const presets = [
    { key: "month", label: "This month" },
    { key: "quarter", label: "This quarter" },
    { key: "year", label: "This year" },
  ];

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
        <input
          type="date"
          value={from}
          onChange={(e) => push({ from: e.target.value, preset: "custom" })}
          className="rounded-lg border border-line bg-surface px-2 py-1 text-fg"
          aria-label="From date"
        />
        <span>→</span>
        <input
          type="date"
          value={to}
          onChange={(e) => push({ to: e.target.value, preset: "custom" })}
          className="rounded-lg border border-line bg-surface px-2 py-1 text-fg"
          aria-label="To date"
        />
      </div>
    </div>
  );
}
