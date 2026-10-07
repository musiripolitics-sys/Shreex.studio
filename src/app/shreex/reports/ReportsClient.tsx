"use client";

import { useState } from "react";
import { Card, EmptyState } from "@/components/os/ui";

export type Report = {
  key: string;
  title: string;
  columns: string[];
  rows: (string | number)[][];
  /** Index of a YYYY-MM-DD date column, enabling the period filter. */
  dateIdx?: number;
};

type Period = "all" | "week" | "month" | "quarter";

function rangeFor(period: Period): [string, string] | null {
  if (period === "all") return null;
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (period === "week") {
    const start = new Date(now);
    start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    return [iso(start), iso(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6))];
  }
  if (period === "month") return [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))];
  const q = Math.floor(m / 3) * 3;
  return [iso(new Date(y, q, 1)), iso(new Date(y, q + 3, 0))];
}

function toCSV(columns: string[], rows: (string | number)[][]): string {
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}

function download(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ReportsClient({ reports }: { reports: Report[] }) {
  const [active, setActive] = useState(reports[0]?.key ?? "");
  const [period, setPeriod] = useState<Period>("all");
  const base = reports.find((r) => r.key === active);

  // Apply the period filter when the report declares a date column.
  const report = base
    ? (() => {
        const range = rangeFor(period);
        if (!range || base.dateIdx == null) return base;
        const [from, to] = range;
        return {
          ...base,
          rows: base.rows.filter((row) => {
            const cell = String(row[base.dateIdx as number] ?? "");
            return cell >= from && cell <= to;
          }),
        };
      })()
    : undefined;

  const date = new Date().toISOString().slice(0, 10);
  const periods: { key: Period; label: string }[] = [
    { key: "all", label: "All time" },
    { key: "week", label: "This week" },
    { key: "month", label: "This month" },
    { key: "quarter", label: "This quarter" },
  ];

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg">Reports</h1>
          <p className="text-sm text-muted">Export any dataset to Excel (CSV) or print to PDF.</p>
        </div>
        {report && report.rows.length > 0 && (
          <div className="flex gap-2">
            <button
              onClick={() => download(`techxfluence-${report.key}-${date}.csv`, toCSV(report.columns, report.rows))}
              className="rounded-full bg-brand px-4 py-2 text-sm font-medium text-white"
            >
              ↓ Download CSV
            </button>
            <button
              onClick={() => window.print()}
              className="rounded-full border border-line px-4 py-2 text-sm font-medium text-muted hover:text-fg"
            >
              Print / PDF
            </button>
          </div>
        )}
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {reports.map((r) => (
          <button
            key={r.key}
            onClick={() => setActive(r.key)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
              active === r.key ? "bg-brand text-white" : "border border-line bg-surface text-muted hover:text-fg"
            }`}
          >
            {r.title}
          </button>
        ))}
      </div>

      {base?.dateIdx != null && (
        <div className="mb-4 flex rounded-full border border-line bg-surface p-0.5 w-fit">
          {periods.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                period === p.key ? "bg-brand text-white" : "text-muted hover:text-fg"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {!report || report.rows.length === 0 ? (
        <EmptyState title="No data for this report yet" hint="Add records in the relevant module first." />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-faint">
                {report.columns.map((c) => (
                  <th key={c} className="px-3 py-3 font-semibold">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.rows.slice(0, 200).map((row, i) => (
                <tr key={i} className="border-b border-line/60 last:border-0">
                  {row.map((cell, j) => (
                    <td key={j} className="px-3 py-2.5 text-muted">{String(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {report.rows.length > 200 && (
            <p className="px-3 py-2 text-xs text-faint">Showing first 200 rows — CSV export includes all {report.rows.length}.</p>
          )}
        </Card>
      )}
    </>
  );
}
