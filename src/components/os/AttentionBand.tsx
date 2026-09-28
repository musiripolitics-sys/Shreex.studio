import Link from "next/link";
import { Icon } from "@/components/Icon";

export type AttentionItem = {
  id: string;
  title: string;
  /** What kind of thing is late — "Task", "Goal", "Approval", "Review". */
  kind: string;
  href: string;
  /** Days past the due date. Null for items that are waiting rather than late. */
  daysLate: number | null;
  owner?: string | null;
  note?: string | null;
};

/**
 * The first thing on the dashboard: what is actually late, by name, sorted
 * worst-first. The old dashboard only ever showed counts, which told you
 * something was wrong but not what — so you had to go hunting.
 */
export function AttentionBand({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <div className="mb-4 flex items-center gap-3 rounded-2xl border border-green-200 bg-green-50 px-5 py-4">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-green-500 text-white">
          <Icon name="check" className="h-4 w-4" strokeWidth={2.2} />
        </span>
        <div>
          <p className="font-display text-sm font-bold text-fg">Nothing is overdue</p>
          <p className="text-xs text-muted">
            No late tasks or goals, no approvals waiting, no reviews outstanding.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4 overflow-hidden rounded-2xl border border-red-200 bg-surface shadow-soft">
      <div className="flex items-center justify-between gap-3 border-b border-red-200 bg-red-50 px-5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-red-500 text-white">
            <Icon name="bell" className="h-3.5 w-3.5" strokeWidth={2.2} />
          </span>
          <div>
            <p className="font-display text-sm font-bold text-fg">Needs attention now</p>
            <p className="text-xs text-muted">
              {items.length} item{items.length === 1 ? "" : "s"} late or waiting on you
            </p>
          </div>
        </div>
        <Link
          href="/admin/os/alerts"
          className="shrink-0 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-brand hover:text-brand"
        >
          All alerts
        </Link>
      </div>

      <ul className="divide-y divide-line">
        {items.map((item) => (
          <li key={`${item.kind}-${item.id}`}>
            <Link
              href={item.href}
              className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-surface-2"
            >
              <span className="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-faint">
                {item.kind}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-fg">{item.title}</span>
              {item.owner && (
                <span className="hidden shrink-0 text-xs text-faint sm:inline">{item.owner}</span>
              )}
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
                  item.daysLate == null
                    ? "bg-amber-100 text-amber-700"
                    : item.daysLate >= 14
                      ? "bg-red-500 text-white"
                      : "bg-red-100 text-red-700"
                }`}
              >
                {item.daysLate == null
                  ? (item.note ?? "Waiting")
                  : `${item.daysLate}d late`}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
