/**
 * Maps every key returned by the `bos_section_status()` RPC to where it lives
 * in the Business OS, grouped the same way the sidebar is. The dashboard
 * renders this list verbatim, so a section that exists in the nav but reports
 * no status is a visible gap rather than a silent omission.
 */
export type SectionState = { total: number; open: number | null; overdue: number };
export type SectionStatus = Record<string, SectionState | undefined>;

export type SectionRef = {
  /** Key in the RPC payload. */
  key: string;
  label: string;
  href: string;
  /** What a row in this section is, used in the empty state. */
  noun: string;
};

export const SECTION_GROUPS: { label: string; items: SectionRef[] }[] = [
  {
    label: "Plan",
    items: [
      { key: "roadmap", label: "Roadmap", href: "/admin/os/roadmap", noun: "goals" },
      { key: "tasks", label: "Tasks", href: "/admin/os/tasks", noun: "tasks" },
      { key: "dependencies", label: "Dependencies", href: "/admin/os/dependencies", noun: "links" },
      { key: "task_reviews", label: "Task reviews", href: "/admin/os/reviews?tab=tasks", noun: "reviews" },
      { key: "reviews", label: "Period reviews", href: "/admin/os/reviews", noun: "retros" },
    ],
  },
  {
    label: "Events",
    items: [
      { key: "events", label: "Events", href: "/admin/os/events", noun: "events" },
      { key: "sops", label: "SOPs", href: "/admin/os/sops", noun: "procedures" },
    ],
  },
  {
    label: "Money",
    items: [
      { key: "finance", label: "Revenue", href: "/admin/os/finance", noun: "entries" },
      { key: "expenses", label: "Expenses", href: "/admin/os/finance", noun: "expenses" },
      { key: "cashflow", label: "Cashflow", href: "/admin/os/finance", noun: "months" },
      { key: "vendors", label: "Vendors", href: "/admin/os/vendors", noun: "vendors" },
    ],
  },
  {
    label: "Grow",
    items: [
      { key: "membership", label: "Membership", href: "/admin/os/membership", noun: "members" },
      { key: "crm", label: "Leads", href: "/admin/os/crm", noun: "leads" },
      { key: "partnerships", label: "Partnerships", href: "/admin/os/partnerships", noun: "partners" },
      { key: "influencers", label: "Influencers", href: "/admin/os/influencers", noun: "influencers" },
      { key: "ambassadors", label: "Ambassadors", href: "/admin/os/ambassadors", noun: "ambassadors" },
    ],
  },
  {
    label: "Marketing",
    items: [
      { key: "campaigns", label: "Campaigns", href: "/admin/os/campaigns", noun: "campaigns" },
      { key: "content", label: "Content", href: "/admin/os/content", noun: "posts" },
      { key: "podcast", label: "Podcast", href: "/admin/os/podcast", noun: "episodes" },
      { key: "competitors", label: "Competitors", href: "/admin/os/competitors", noun: "competitors" },
    ],
  },
  {
    label: "Team",
    items: [
      { key: "people", label: "People", href: "/admin/os/people", noun: "employees" },
      { key: "hiring", label: "Hiring", href: "/admin/os/hiring", noun: "roles" },
      { key: "empkpis", label: "Employee KPIs", href: "/admin/os/empkpis", noun: "KPIs" },
    ],
  },
  {
    label: "Product",
    items: [
      { key: "product", label: "Application", href: "/admin/os/product", noun: "modules" },
      { key: "feedback", label: "Feedback", href: "/admin/os/feedback", noun: "items" },
    ],
  },
  {
    label: "Govern",
    items: [
      { key: "approvals", label: "Approvals", href: "/admin/os/approvals", noun: "requests" },
      { key: "risks", label: "Risks", href: "/admin/os/risks", noun: "risks" },
      { key: "legal", label: "Legal", href: "/admin/os/legal", noun: "obligations" },
      { key: "kpis", label: "KPI dictionary", href: "/admin/os/kpis", noun: "definitions" },
      { key: "assets", label: "Assets", href: "/admin/os/assets", noun: "assets" },
      { key: "inventory", label: "Inventory", href: "/admin/os/inventory", noun: "items" },
      { key: "audit", label: "Audit log", href: "/admin/os/audit", noun: "entries" },
    ],
  },
];

/** Total overdue across every section, for the headline counter. */
export function totalOverdue(status: SectionStatus): number {
  return SECTION_GROUPS.flatMap((g) => g.items).reduce(
    (sum, item) => sum + (status[item.key]?.overdue ?? 0),
    0,
  );
}

/** Sections holding no records at all — the "not started yet" list. */
export function emptySections(status: SectionStatus): SectionRef[] {
  return SECTION_GROUPS.flatMap((g) => g.items).filter(
    (item) => (status[item.key]?.total ?? 0) === 0,
  );
}
