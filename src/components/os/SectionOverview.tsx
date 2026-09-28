import Link from "next/link";
import { Icon } from "@/components/Icon";

export type SectionCard = {
  key: string;
  label: string;
  icon: string;
  href: string;
  /** The one number that answers "how is this section doing". */
  value: string;
  /** What that number counts. */
  unit: string;
  /** Traffic light. `empty` means the section holds no records at all. */
  tone: "ok" | "watch" | "action" | "empty";
  /** Short state line, e.g. "3 overdue" or "nothing scheduled". */
  state: string;
};

// Green on track, amber watch, red action needed — the convention every
// dashboard reader already knows, so the colour does the explaining.
const TONE: Record<SectionCard["tone"], { dot: string; chip: string; ring: string }> = {
  ok:     { dot: "bg-green-500", chip: "text-green-700 bg-green-50",  ring: "border-line" },
  watch:  { dot: "bg-amber-500", chip: "text-amber-700 bg-amber-50",  ring: "border-amber-200" },
  action: { dot: "bg-red-500",   chip: "text-red-700 bg-red-50",      ring: "border-red-200" },
  empty:  { dot: "bg-slate-300", chip: "text-faint bg-surface-2",     ring: "border-dashed border-line" },
};

/**
 * Nine cards, one per section of the Business OS, in the same order as the
 * sidebar. Each carries a single number and a traffic light rather than a wall
 * of statistics — the detail lives one click away on the section's own page.
 */
export function SectionOverview({ sections }: { sections: SectionCard[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {sections.map((s) => {
        const tone = TONE[s.tone];
        return (
          <Link
            key={s.key}
            href={s.href}
            className={`group flex items-center gap-4 rounded-2xl border bg-surface p-4 shadow-soft transition-all hover:-translate-y-0.5 hover:border-brand/40 ${tone.ring}`}
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-surface-2 text-faint transition-colors group-hover:bg-brand group-hover:text-white">
              <Icon name={s.icon} className="h-5 w-5" strokeWidth={1.7} />
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-faint">
                {s.label}
              </p>
              <p className="font-display text-2xl font-bold leading-tight tabular-nums text-fg">
                {s.value}
                <span className="ml-1.5 text-xs font-medium text-muted">{s.unit}</span>
              </p>
            </div>

            <span
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${tone.chip}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
              {s.state}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
