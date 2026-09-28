/**
 * Techxfluence Business Operating System — shared vocabulary.
 *
 * Pure types, constants and formatters. No server-only imports, so this is
 * safe to pull into both Server Components and Client Components. Money is
 * handled in PAISE everywhere (matching public.payments.amount); convert to
 * rupees only at the display / form boundary.
 */

// ─────────────────────────── Enums (mirror the DB) ───────────────────────────

export const BOS_STATUSES = [
  "not_started",
  "in_progress",
  "blocked",
  "completed",
  "on_hold",
  "cancelled",
] as const;
export type BosStatus = (typeof BOS_STATUSES)[number];

export const BOS_PRIORITIES = ["critical", "high", "medium", "low"] as const;
export type BosPriority = (typeof BOS_PRIORITIES)[number];

export const BOS_FREQUENCIES = ["daily", "weekly", "monthly", "one_time"] as const;
export type BosFrequency = (typeof BOS_FREQUENCIES)[number];

export const CRM_STAGES = [
  "lead",
  "contacted",
  "qualified",
  "proposal",
  "negotiation",
  "won",
  "lost",
] as const;
export type CrmStage = (typeof CRM_STAGES)[number];

// ─────────────────────────── Display metadata ───────────────────────────

/** Tailwind chip classes per status (kept literal so JIT keeps the classes). */
export const STATUS_META: Record<BosStatus, { label: string; chip: string; dot: string }> = {
  not_started: { label: "Not started", chip: "bg-slate-100 text-slate-600", dot: "bg-slate-400" },
  in_progress: { label: "In progress", chip: "bg-blue-100 text-blue-700", dot: "bg-blue-500" },
  blocked: { label: "Blocked", chip: "bg-red-100 text-red-700", dot: "bg-red-500" },
  completed: { label: "Completed", chip: "bg-green-100 text-green-700", dot: "bg-green-500" },
  on_hold: { label: "On hold", chip: "bg-amber-100 text-amber-700", dot: "bg-amber-500" },
  cancelled: { label: "Cancelled", chip: "bg-slate-100 text-slate-400 line-through", dot: "bg-slate-300" },
};

export const PRIORITY_META: Record<BosPriority, { label: string; chip: string }> = {
  critical: { label: "Critical", chip: "bg-red-100 text-red-700" },
  high: { label: "High", chip: "bg-orange-100 text-orange-700" },
  medium: { label: "Medium", chip: "bg-blue-100 text-blue-700" },
  low: { label: "Low", chip: "bg-slate-100 text-slate-600" },
};

export const STAGE_META: Record<CrmStage, { label: string; chip: string }> = {
  lead: { label: "Lead", chip: "bg-slate-100 text-slate-600" },
  contacted: { label: "Contacted", chip: "bg-sky-100 text-sky-700" },
  qualified: { label: "Qualified", chip: "bg-indigo-100 text-indigo-700" },
  proposal: { label: "Proposal", chip: "bg-violet-100 text-violet-700" },
  negotiation: { label: "Negotiation", chip: "bg-amber-100 text-amber-700" },
  won: { label: "Won", chip: "bg-green-100 text-green-700" },
  lost: { label: "Lost", chip: "bg-red-100 text-red-700" },
};

export const freqLabel = (f: BosFrequency) =>
  ({ daily: "Daily", weekly: "Weekly", monthly: "Monthly", one_time: "One-time" }[f]);

// ─────────────────────────── Money & numbers ───────────────────────────

/** Format paise as compact Indian rupees, e.g. 125000 → "₹1,250". */
export function inr(paise: number | null | undefined, opts?: { decimals?: boolean }): string {
  const rupees = (paise ?? 0) / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: opts?.decimals ? 2 : 0,
  }).format(rupees);
}

/** Compact rupees for tight KPI cards, e.g. 1_50_00000 paise → "₹1.5L". */
export function inrCompact(paise: number | null | undefined): string {
  const r = (paise ?? 0) / 100;
  if (Math.abs(r) >= 1e7) return `₹${(r / 1e7).toFixed(2).replace(/\.00$/, "")}Cr`;
  if (Math.abs(r) >= 1e5) return `₹${(r / 1e5).toFixed(2).replace(/\.00$/, "")}L`;
  if (Math.abs(r) >= 1e3) return `₹${(r / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return `₹${Math.round(r)}`;
}

export const rupeesToPaise = (rupees: number) => Math.round(rupees * 100);
export const paiseToRupees = (paise: number) => (paise ?? 0) / 100;

export const num = (n: number | null | undefined) =>
  new Intl.NumberFormat("en-IN").format(n ?? 0);

export const pct = (value: number | null | undefined) =>
  `${Math.round(((value ?? 0) + Number.EPSILON) * 10) / 10}%`;

/** Signed variance chip helper: positive = good (green) unless inverted. */
export function variance(actual: number, target: number, invert = false) {
  const diff = actual - target;
  const good = invert ? diff <= 0 : diff >= 0;
  return { diff, good, pct: target ? (diff / target) * 100 : 0 };
}

export function shortDate(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return d;
  }
}

// ─────────────────────────── Dashboard shape ───────────────────────────

export type DashboardSummary = {
  revenue_actual: number;
  revenue_target: number;
  revenue_forecast: number;
  expenses_total: number;
  expenses_forecast: number;
  cash_position: number;
  monthly_burn: number;
  runway_months: number | null;
  members_total: number;
  members_free: number;
  members_paid: number;
  members_elite: number;
  members_new: number;
  member_conversion: number;
  member_retention: number;
  influencers: number;
  ambassadors: number;
  hosts: number;
  partners: number;
  events_upcoming: number;
  events_completed: number;
  events_registrations: number;
  events_attendance: number;
  event_revenue: number;
  event_cost: number;
  client_events: number;
  owned_events: number;
  mkt_spend: number;
  mkt_leads: number;
  mkt_conversions: number;
  mkt_reach: number;
  mkt_revenue: number;
  content_published: number;
  leads_total: number;
  leads_qualified: number;
  leads_proposal: number;
  leads_negotiation: number;
  pipeline_value: number;
  weighted_pipeline: number;
  revenue_closed: number;
  deals_won: number;
  deals_lost: number;
  app_total: number;
  app_completed: number;
  app_pending: number;
  app_blocked: number;
  app_bugs: number;
  app_progress: number;
  employees: number;
  open_positions: number;
  planned_hires: number;
  monthly_payroll: number;
  hiring_cost: number;
  emp_kpi_achievement: number;
  tasks_open: number;
  tasks_overdue: number;
  tasks_due_today: number;
  tasks_critical: number;
  tasks_blocked: number;
  approvals_pending: number;
  risks_open: number;
  risks_critical: number;
  deps_open: number;
  contracts_expiring: number;
  goals: Partial<Record<BosStatus, number>>;
  range: { from: string; to: string };
};
