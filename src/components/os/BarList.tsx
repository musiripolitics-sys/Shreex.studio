import { Card, EmptyState } from "@/components/os/ui";

export type BarDatum = { label: string; value: number; display?: string };

/**
 * A compact horizontal bar list — the workhorse chart for the BI page. No
 * chart library; just scaled divs so it stays light and themable.
 */
export function BarList({
  title,
  desc,
  data,
  color = "var(--color-brand)",
  emptyHint,
}: {
  title: string;
  desc?: string;
  data: BarDatum[];
  color?: string;
  emptyHint?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <Card>
      <div className="mb-3">
        <h3 className="font-display text-sm font-semibold text-fg">{title}</h3>
        {desc && <p className="text-xs text-muted">{desc}</p>}
      </div>
      {data.length === 0 ? (
        <EmptyState title="No data yet" hint={emptyHint} />
      ) : (
        <div className="space-y-2.5">
          {data.map((d) => (
            <div key={d.label}>
              <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-muted">{d.label}</span>
                <span className="shrink-0 font-medium tabular-nums text-fg">{d.display ?? d.value}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-ink-2">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.max((d.value / max) * 100, d.value > 0 ? 3 : 0)}%`, background: color }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
