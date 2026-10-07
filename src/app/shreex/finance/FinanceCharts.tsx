"use client";

import { useMemo, useState } from "react";
import { inr, inrCompact } from "@/lib/bos";

/**
 * Charts for the money.
 *
 * Colours are the three leading slots of a validated categorical palette —
 * aqua, orange, blue — checked against this app's white surface for
 * colourblind separation rather than chosen by eye. Aqua sits below 3:1
 * contrast on white, so every chart that uses it ships visible labels and a
 * table view; that is the required relief, not a nicety.
 *
 * One vertical scale everywhere. Two money measures at different magnitudes
 * get two charts, never two axes on one.
 */
const C = {
  in: "#1baf7a",      // money arriving
  out: "#eb6834",     // money leaving
  net: "#2a78d6",     // what is left
  grid: "#e6e5df",
  axis: "#8a897f",
  ink: "#0e0e0c",
  muted: "#56564f",
};

const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-IN", { month: "short" });
};

/** A bar with only its outer end rounded, so it stays anchored to the baseline. */
function barPath(x: number, y: number, w: number, h: number, up: boolean, r = 4) {
  const rad = Math.min(r, w / 2, Math.abs(h));
  if (h <= 0.5) return "";
  return up
    ? `M${x},${y + h} V${y + rad} Q${x},${y} ${x + rad},${y} H${x + w - rad} Q${x + w},${y} ${x + w},${y + rad} V${y + h} Z`
    : `M${x},${y} V${y + h - rad} Q${x},${y + h} ${x + rad},${y + h} H${x + w - rad} Q${x + w},${y + h} ${x + w},${y + h - rad} V${y} Z`;
}

function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5 text-[11px] text-muted">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

// ─────────────────────────── Money in, money out ───────────────────────────

export type FlowPoint = { month: string; inAmt: number; outAmt: number };

/**
 * Money in above the line, money out below it, net as a line through both.
 *
 * Drawn around zero rather than as side-by-side columns because that is what
 * the question actually is — did more arrive than left — and a reader gets it
 * without comparing two bar heights.
 */
export function MoneyFlow({ data }: { data: FlowPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const W = 760, H = 260, PAD_L = 56, PAD_R = 16, PAD_T = 16, PAD_B = 28;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;

  const { maxIn, maxOut, band, bw, zeroY, scale } = useMemo(() => {
    // One scale for both halves — a bar of a given height means the same
    // amount whether it points up or down. What moves is the zero line, which
    // sits wherever the split between in and out puts it. Fixing it at the
    // middle would waste half the chart on a month with no expenses, and
    // giving each half its own scale would be a second axis in disguise.
    const hiIn = Math.max(0, ...data.map((d) => d.inAmt));
    const hiOut = Math.max(0, ...data.map((d) => d.outAmt));
    const span = Math.max(1, hiIn + hiOut);
    const b = data.length ? plotW / data.length : plotW;
    return {
      maxIn: hiIn,
      maxOut: hiOut,
      band: b,
      bw: Math.max(6, Math.min(34, b * 0.52)),
      zeroY: PAD_T + (hiIn / span) * plotH,
      scale: (v: number) => (v / span) * plotH,
    };
  }, [data, plotW, plotH]);

  if (data.length === 0) {
    return <p className="py-10 text-center text-xs text-faint">No money has moved yet.</p>;
  }

  const netPoints = data.map((d, i) => {
    const x = PAD_L + i * band + band / 2;
    const y = zeroY - scale(d.inAmt - d.outAmt);
    return `${x},${y}`;
  });

  const hovered = hover != null ? data[hover] : null;

  return (
    <div className="relative">
      <Legend items={[{ color: C.in, label: "Money in" }, { color: C.out, label: "Money out" }, { color: C.net, label: "Net" }]} />
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
        aria-label="Money in and out by month, with the net line">
        {/* Grid: recessive, and only where it helps */}
        <line x1={PAD_L} x2={W - PAD_R} y1={zeroY} y2={zeroY} stroke={C.axis} strokeWidth={1} />
        <text x={PAD_L - 8} y={zeroY + 3} textAnchor="end" fontSize="9" fill={C.axis}>0</text>
        {maxIn > 0 && (
          <>
            <line x1={PAD_L} x2={W - PAD_R} y1={zeroY - scale(maxIn)} y2={zeroY - scale(maxIn)} stroke={C.grid} />
            <text x={PAD_L - 8} y={zeroY - scale(maxIn) + 3} textAnchor="end" fontSize="9" fill={C.axis}>
              {inrCompact(maxIn)}
            </text>
          </>
        )}
        {maxOut > 0 && (
          <>
            <line x1={PAD_L} x2={W - PAD_R} y1={zeroY + scale(maxOut)} y2={zeroY + scale(maxOut)} stroke={C.grid} />
            <text x={PAD_L - 8} y={zeroY + scale(maxOut) + 3} textAnchor="end" fontSize="9" fill={C.axis}>
              {inrCompact(maxOut)}
            </text>
          </>
        )}

        {data.map((d, i) => {
          const x = PAD_L + i * band + (band - bw) / 2;
          const hIn = scale(d.inAmt), hOut = scale(d.outAmt);
          const dim = hover != null && hover !== i;
          return (
            <g key={d.month} opacity={dim ? 0.35 : 1}>
              {/* A 2px gap keeps the two fills from touching at the baseline */}
              <path d={barPath(x, zeroY - hIn, bw, hIn, true)} fill={C.in} />
              <path d={barPath(x, zeroY + 2, bw, hOut, false)} fill={C.out} />
            </g>
          );
        })}

        <polyline points={netPoints.join(" ")} fill="none" stroke={C.net} strokeWidth={2}
          strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => {
          const [x, y] = netPoints[i].split(",").map(Number);
          return <circle key={d.month} cx={x} cy={y} r={hover === i ? 5 : 4} fill={C.net} stroke="#fff" strokeWidth={2} />;
        })}

        {data.map((d, i) => (
          <text key={d.month} x={PAD_L + i * band + band / 2} y={H - 8} textAnchor="middle"
            fontSize="9" fill={C.axis}>{monthLabel(d.month)}</text>
        ))}

        {/* Hit targets wider than the marks */}
        {data.map((d, i) => (
          <rect key={d.month} x={PAD_L + i * band} y={PAD_T} width={band} height={plotH}
            fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
        ))}
      </svg>

      {hovered && (
        <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-soft">
          <p className="font-semibold text-fg">{monthLabel(hovered.month)} {hovered.month.slice(0, 4)}</p>
          <p style={{ color: C.in }}>In {inr(hovered.inAmt)}</p>
          <p style={{ color: C.out }}>Out {inr(hovered.outAmt)}</p>
          <p className="font-medium" style={{ color: C.net }}>
            Net {hovered.inAmt - hovered.outAmt >= 0 ? "+" : ""}{inr(hovered.inAmt - hovered.outAmt)}
          </p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── Where it has got to ───────────────────────────

/** Running total of net, which is the line people actually care about. */
export function CumulativeNet({ data }: { data: FlowPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 760, H = 180, PAD_L = 56, PAD_R = 16, PAD_T = 14, PAD_B = 26;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;

  const series = useMemo(
    () =>
      data.reduce<{ month: string; value: number }[]>((acc, d) => {
        const prev = acc.length ? acc[acc.length - 1].value : 0;
        return [...acc, { month: d.month, value: prev + d.inAmt - d.outAmt }];
      }, []),
    [data],
  );

  if (series.length < 2) {
    return <p className="py-8 text-center text-xs text-faint">Two months of history will draw a trend here.</p>;
  }

  const lo = Math.min(0, ...series.map((s) => s.value));
  const hi = Math.max(0, ...series.map((s) => s.value));
  const span = hi - lo || 1;
  const x = (i: number) => PAD_L + (i / (series.length - 1)) * plotW;
  const y = (v: number) => PAD_T + plotH - ((v - lo) / span) * plotH;

  const line = series.map((s, i) => `${x(i)},${y(s.value)}`).join(" ");
  const area = `M${x(0)},${y(lo < 0 ? 0 : lo)} L${series.map((s, i) => `${x(i)},${y(s.value)}`).join(" L")} L${x(series.length - 1)},${y(lo < 0 ? 0 : lo)} Z`;
  const last = series[series.length - 1];

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Cumulative net position over time">
        <defs>
          <linearGradient id="netfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.net} stopOpacity="0.22" />
            <stop offset="100%" stopColor={C.net} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <line x1={PAD_L} x2={W - PAD_R} y1={y(0)} y2={y(0)} stroke={C.axis} strokeWidth={1} />
        <text x={PAD_L - 8} y={y(hi) + 3} textAnchor="end" fontSize="9" fill={C.axis}>{inrCompact(hi)}</text>
        <text x={PAD_L - 8} y={y(0) + 3} textAnchor="end" fontSize="9" fill={C.axis}>0</text>

        <path d={area} fill="url(#netfill)" />
        <polyline points={line} fill="none" stroke={C.net} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hover != null && (
          <line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={PAD_T + plotH} stroke={C.axis} strokeWidth={1} strokeDasharray="3 3" />
        )}
        <circle cx={x(series.length - 1)} cy={y(last.value)} r={4} fill={C.net} stroke="#fff" strokeWidth={2} />
        {/* The only number on the plot: the one that matters */}
        <text x={x(series.length - 1) - 6} y={y(last.value) - 10} textAnchor="end" fontSize="11"
          fontWeight="600" fill={C.ink}>{inrCompact(last.value)}</text>

        {series.map((s, i) => (
          <text key={s.month} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" fill={C.axis}
            opacity={series.length > 12 && i % 2 ? 0 : 1}>{monthLabel(s.month)}</text>
        ))}
        {series.map((s, i) => (
          <rect key={s.month} x={x(i) - plotW / series.length / 2} y={PAD_T} width={plotW / series.length} height={plotH}
            fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
        ))}
      </svg>
      {hover != null && (
        <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs shadow-soft">
          <span className="text-muted">{monthLabel(series[hover].month)} · </span>
          <span className="font-semibold text-fg">{inr(series[hover].value)}</span>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── Where it goes / comes from ───────────────────────────

export type Slice = { label: string; value: number };

/**
 * Magnitude, so one hue light-to-dark rather than a colour per row — the rows
 * are not identities, they are amounts, and a category that changes colour when
 * the filter changes is a lie about the data.
 */
export function Breakdown({ rows, hue = "blue" }: { rows: Slice[]; hue?: "blue" | "orange" }) {
  const RAMP = hue === "blue"
    ? ["#104281", "#184f95", "#256abf", "#2a78d6", "#3987e5", "#5598e7", "#6da7ec", "#86b6ef"]
    : ["#8a3212", "#a63f18", "#c24d1f", "#eb6834", "#ef8055", "#f39877", "#f7b099", "#fbc8bb"];

  const total = rows.reduce((a, r) => a + r.value, 0);
  if (rows.length === 0 || total === 0) {
    return <p className="py-8 text-center text-xs text-faint">Nothing recorded yet.</p>;
  }

  // Past eight rows the tail becomes "Other" rather than inventing more steps.
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, 7);
  const tail = sorted.slice(7);
  const shown = tail.length
    ? [...head, { label: `Other (${tail.length})`, value: tail.reduce((a, r) => a + r.value, 0) }]
    : head;
  const peak = Math.max(...shown.map((r) => r.value));

  return (
    <ul className="space-y-2">
      {shown.map((r, i) => (
        <li key={r.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="truncate text-xs text-fg">{r.label}</span>
            <span className="shrink-0 text-xs tabular-nums text-muted">
              {inr(r.value)} <span className="text-faint">· {Math.round((r.value / total) * 100)}%</span>
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.max(1.5, (r.value / peak) * 100)}%`, background: RAMP[Math.min(i, RAMP.length - 1)] }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** The same numbers as text, which is what the contrast warning obliges. */
export function FlowTable({ data }: { data: FlowPoint[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[26rem] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-faint">
            <th className="py-2 font-semibold">Month</th>
            <th className="py-2 text-right font-semibold">In</th>
            <th className="py-2 text-right font-semibold">Out</th>
            <th className="py-2 text-right font-semibold">Net</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => {
            const net = d.inAmt - d.outAmt;
            return (
              <tr key={d.month} className="border-b border-line/60 last:border-0">
                <td className="py-2 text-xs text-muted">{monthLabel(d.month)} {d.month.slice(0, 4)}</td>
                <td className="py-2 text-right tabular-nums text-fg">{inr(d.inAmt)}</td>
                <td className="py-2 text-right tabular-nums text-fg">{inr(d.outAmt)}</td>
                <td className={`py-2 text-right font-medium tabular-nums ${net >= 0 ? "text-green-700" : "text-red-600"}`}>
                  {net >= 0 ? "+" : ""}{inr(net)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
