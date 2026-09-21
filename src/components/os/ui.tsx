import Link from "next/link";
import type { ReactNode } from "react";
import {
  STATUS_META,
  PRIORITY_META,
  STAGE_META,
  type BosStatus,
  type BosPriority,
  type CrmStage,
} from "@/lib/bos";

/** A soft-elevated content card, matching the site's `.shadow-soft` cards. */
export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-line bg-surface p-5 shadow-soft ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * A clickable KPI tile. Every dashboard number links to the records behind it
 * (requirement: "Every KPI must be clickable"). When `value` is empty we show
 * a muted 0 / placeholder rather than a fake statistic.
 */
export function KpiCard({
  label,
  value,
  sub,
  href,
  tone = "default",
  hint,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  href?: string;
  tone?: "default" | "good" | "bad" | "warn" | "brand";
  hint?: string;
}) {
  const toneClass = {
    default: "text-fg",
    good: "text-green-600",
    bad: "text-red-600",
    warn: "text-amber-600",
    brand: "text-brand-soft",
  }[tone];

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-faint">
          {label}
        </p>
        {href && (
          <span className="text-faint transition-colors group-hover:text-brand-soft">
            ↗
          </span>
        )}
      </div>
      <p className={`mt-2 font-display text-2xl font-bold tabular-nums ${toneClass}`}>
        {value}
      </p>
      {sub != null && <p className="mt-1 text-xs text-muted">{sub}</p>}
      {hint && <p className="mt-0.5 text-[11px] text-faint">{hint}</p>}
    </>
  );

  const base =
    "group block rounded-2xl border border-line bg-surface p-4 shadow-soft transition-all";
  return href ? (
    <Link href={href} className={`${base} hover:-translate-y-0.5 hover:border-brand/40`}>
      {body}
    </Link>
  ) : (
    <div className={base}>{body}</div>
  );
}

export function StatusBadge({ status }: { status: BosStatus }) {
  const m = STATUS_META[status] ?? STATUS_META.not_started;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${m.chip}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: BosPriority }) {
  const m = PRIORITY_META[priority] ?? PRIORITY_META.medium;
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${m.chip}`}>
      {m.label}
    </span>
  );
}

export function StageBadge({ stage }: { stage: CrmStage }) {
  const m = STAGE_META[stage] ?? STAGE_META.lead;
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${m.chip}`}>
      {m.label}
    </span>
  );
}

/** Shown wherever a module has no rows yet — never a fake number. */
export function EmptyState({
  title = "No data yet",
  hint,
  action,
}: {
  title?: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-surface-2 px-6 py-12 text-center">
      <p className="font-display text-sm font-semibold text-fg">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-xs text-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function SectionHeading({
  title,
  desc,
  right,
}: {
  title: string;
  desc?: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <h2 className="font-display text-lg font-semibold text-fg">{title}</h2>
        {desc && <p className="text-xs text-muted">{desc}</p>}
      </div>
      {right}
    </div>
  );
}

/** A thin target-vs-actual progress bar. */
export function Meter({
  actual,
  target,
  invert = false,
}: {
  actual: number;
  target: number;
  invert?: boolean;
}) {
  const ratio = target > 0 ? Math.min(actual / target, 1) : 0;
  const good = invert ? actual <= target : actual >= target;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-2">
      <div
        className={`h-full rounded-full ${good ? "bg-green-500" : "bg-brand"}`}
        style={{ width: `${Math.max(ratio * 100, target === 0 ? 0 : 2)}%` }}
      />
    </div>
  );
}
