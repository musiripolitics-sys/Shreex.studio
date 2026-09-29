"use client";

import { shortDate } from "@/lib/bos";

export type Change = {
  id: number | string;
  entity: string;
  entity_id: string;
  field: string;
  before: string | null;
  after: string | null;
  changed_by: string | null;
  changed_at: string;
};

const PRETTY: Record<string, string> = {
  owner_id: "Owner",
  next_review: "Next review",
  due_date: "Due",
  risk_score: "Score",
  is_personal: "Personal data",
  retention_days: "Retention (days)",
  custodian_id: "Held by",
  resolve_by: "Resolve by",
  root_cause: "Root cause",
};

const label = (f: string) =>
  PRETTY[f] ?? f.replace(/_id$/, "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/**
 * What happened to this record.
 *
 * Written by a trigger rather than by the pages, so it is the whole story
 * rather than the parts somebody remembered to log — and it cannot be edited
 * or deleted, which is the only reason it is worth reading.
 */
export function ChangeHistory({
  changes,
  nameOf,
  limit = 40,
}: {
  changes: Change[];
  nameOf: (id: string | null) => string;
  limit?: number;
}) {
  if (changes.length === 0) {
    return <p className="text-xs text-faint">Nothing has changed since this was created.</p>;
  }

  // An id in a before/after is meaningless to read; show the person.
  const value = (field: string, v: string | null) => {
    if (v === null || v === "") return "empty";
    if (field.endsWith("_id")) return nameOf(v);
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return shortDate(v);
    if (v === "true") return "yes";
    if (v === "false") return "no";
    return v.length > 60 ? `${v.slice(0, 60)}…` : v;
  };

  return (
    <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
      {changes.slice(0, limit).map((c) => (
        <li key={c.id} className="rounded-lg bg-surface-2/60 px-2.5 py-1.5">
          <p className="text-[10px] uppercase tracking-wider text-faint">
            {nameOf(c.changed_by)} · {shortDate(c.changed_at)}
          </p>
          <p className="text-xs text-fg">
            <span className="font-medium">{label(c.field)}</span>{" "}
            <span className="text-muted">{value(c.field, c.before)}</span>
            <span className="mx-1 text-faint">→</span>
            <span>{value(c.field, c.after)}</span>
          </p>
        </li>
      ))}
      {changes.length > limit && (
        <li className="px-2.5 text-[11px] text-faint">
          and {changes.length - limit} earlier changes
        </li>
      )}
    </ul>
  );
}
