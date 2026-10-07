import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The dense layer.
 *
 * Shreex is a tool people are in all day, and the research on daily-use
 * software is consistent: minimalism costs those people time, because every
 * level of navigation they have to walk is strain the layout caused. Density
 * structured well reduces that. What density is NOT is cramming — the current
 * dashboard is dense with NUMBERS and sparse in decisions, which is the worst
 * of both.
 *
 * So the rules here, and they are the whole design:
 *
 *   1. A number earns its place only if it implies an action. "47 tasks" does
 *      not. "6 overdue" does.
 *   2. The first thing on the page is work, not metrics.
 *   3. 13px base, 32px rows, one accent. Colour means "attend to this", never
 *      decoration, so an interface with nothing wrong in it is grey.
 *   4. Show five and a count. Progressive disclosure is what lets density stay
 *      readable.
 */

/* ── Page frame ─────────────────────────────────────────────── */

/**
 * One line of context, not a billboard.
 *
 * The old header was a 24px bold H1 reading "Executive Dashboard" above a
 * second uppercase subhead — two type systems arguing, and 40 vertical pixels
 * spent telling you the name of the page you just clicked.
 */
export function PageHead({
  title,
  context,
  actions,
}: {
  title: string;
  context?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h1 className="font-display text-[15px] font-semibold tracking-tight text-fg">{title}</h1>
        {context && <span className="text-[12px] text-faint">{context}</span>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  );
}

/* ── Numbers, demoted ───────────────────────────────────────── */

export type StatTone = "plain" | "warn" | "bad" | "good";

const TONE: Record<StatTone, { value: string; dot: string }> = {
  plain: { value: "text-fg", dot: "" },
  good: { value: "text-emerald-700", dot: "bg-emerald-500" },
  warn: { value: "text-amber-700", dot: "bg-amber-500" },
  bad: { value: "text-red-700", dot: "bg-red-500" },
};

/**
 * A strip, not a grid of cards.
 *
 * Four KpiCards in a 2x4 grid cost about 180 vertical pixels to say four
 * numbers. This says the same in one row, which is what lets the work queue
 * start above the fold — and above the fold is the whole argument, because
 * people scan a dashboard rather than reading it.
 */
export function StatStrip({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 grid grid-cols-2 divide-line rounded-lg border border-line bg-surface sm:grid-cols-4 sm:divide-x">
      {children}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "plain",
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: StatTone;
  href?: string;
}) {
  const t = TONE[tone];
  const body = (
    <>
      <div className="flex items-center gap-1.5">
        {t.dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.dot}`} aria-hidden />}
        <span className="truncate text-[11px] font-medium uppercase tracking-[0.08em] text-faint">
          {label}
        </span>
      </div>
      <div className={`mt-0.5 font-display text-[19px] font-semibold tabular-nums leading-none ${t.value}`}>
        {value}
      </div>
      {hint && <div className="mt-1 truncate text-[11px] text-faint">{hint}</div>}
    </>
  );
  const cls = "min-w-0 border-b border-line px-3.5 py-2.5 last:border-b-0 sm:border-b-0";
  return href ? (
    <Link href={href} className={`${cls} transition-colors hover:bg-surface-2`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/* ── Work, promoted ─────────────────────────────────────────── */

/**
 * A panel whose header carries its own count and a way out.
 *
 * Every queue on the dashboard is this: a label, how many there are, five of
 * them, and a link to the rest. The count lives in the header rather than in a
 * card of its own, which is the trade that buys the vertical space.
 */
export function Queue({
  title,
  count,
  tone = "plain",
  href,
  hrefLabel = "All",
  empty,
  children,
}: {
  title: string;
  count?: number;
  tone?: StatTone;
  href?: string;
  hrefLabel?: string;
  empty?: string;
  children?: ReactNode;
}) {
  const showEmpty = count === 0 || !children;
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-line bg-surface">
      <header className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-[12px] font-semibold text-fg">{title}</h2>
          {typeof count === "number" && count > 0 && (
            <span
              className={`rounded px-1.5 py-px text-[11px] font-semibold tabular-nums ${
                tone === "bad"
                  ? "bg-red-50 text-red-700"
                  : tone === "warn"
                    ? "bg-amber-50 text-amber-700"
                    : "bg-surface-2 text-muted"
              }`}
            >
              {count}
            </span>
          )}
        </div>
        {href && !showEmpty && (
          <Link href={href} className="shrink-0 text-[11px] font-medium text-faint hover:text-brand">
            {hrefLabel} →
          </Link>
        )}
      </header>
      {showEmpty ? (
        <p className="px-3.5 py-5 text-center text-[12px] text-faint">{empty ?? "Nothing here."}</p>
      ) : (
        <div className="divide-y divide-line">{children}</div>
      )}
    </section>
  );
}

/**
 * One line of work. The whole row is the target — a 32px row with a small link
 * inside it is a row you have to aim at.
 */
export function Row({
  href,
  primary,
  secondary,
  meta,
  tone = "plain",
}: {
  href: string;
  primary: ReactNode;
  secondary?: ReactNode;
  meta?: ReactNode;
  tone?: StatTone;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-[32px] items-center gap-2.5 px-3.5 py-1.5 text-[13px] transition-colors hover:bg-surface-2"
    >
      {tone !== "plain" && (
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE[tone].dot}`} aria-hidden />
      )}
      <span className="min-w-0 flex-1 truncate text-fg">{primary}</span>
      {secondary && <span className="hidden shrink-0 truncate text-[12px] text-faint sm:inline">{secondary}</span>}
      {meta && (
        <span className={`shrink-0 tabular-nums text-[12px] ${tone === "bad" ? "text-red-700" : "text-faint"}`}>
          {meta}
        </span>
      )}
    </Link>
  );
}

/* ── Progressive disclosure ─────────────────────────────────── */

/**
 * The nine products, as one line each.
 *
 * This replaced a grid of link cards. A card per product is a lot of surface
 * to say "this exists"; a row with its one number says the same and leaves
 * room for the work above it.
 */
export function ProductList({ children }: { children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface">
      <header className="border-b border-line px-3.5 py-2">
        <h2 className="text-[12px] font-semibold text-fg">Products</h2>
      </header>
      <div className="divide-y divide-line">{children}</div>
    </section>
  );
}

export function ProductRow({
  href,
  name,
  detail,
  count,
}: {
  href: string;
  name: string;
  detail?: string;
  count?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-[32px] items-center gap-3 px-3.5 py-1.5 text-[13px] transition-colors hover:bg-surface-2"
    >
      <span className="w-28 shrink-0 truncate font-medium text-fg">{name}</span>
      <span className="min-w-0 flex-1 truncate text-[12px] text-faint">{detail}</span>
      {count != null && <span className="shrink-0 tabular-nums text-[12px] text-muted">{count}</span>}
    </Link>
  );
}

/** A two-column frame that collapses to one. Work left, context right. */
export function Split({ main, aside }: { main: ReactNode; aside: ReactNode }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">{main}</div>
      <div className="min-w-0 space-y-4">{aside}</div>
    </div>
  );
}
