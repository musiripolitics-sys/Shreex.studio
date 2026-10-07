/**
 * Shape of the `bos_section_status()` RPC payload, keyed by section.
 * The dashboard reads individual keys from this to build its nine section
 * cards; SECTION_GROUPS below still describes where each key lives.
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
      { key: "roadmap", label: "Roadmap", href: "/shreex/roadmap", noun: "goals" },
      { key: "tasks", label: "Tasks", href: "/shreex/tasks", noun: "tasks" },
      { key: "dependencies", label: "Dependencies", href: "/shreex/dependencies", noun: "links" },
      { key: "task_reviews", label: "Task reviews", href: "/shreex/reviews?tab=tasks", noun: "reviews" },
      { key: "reviews", label: "Period reviews", href: "/shreex/reviews", noun: "retros" },
    ],
  },
  {
    label: "Events",
    items: [
      { key: "events", label: "Events", href: "/shreex/events", noun: "events" },
      { key: "sops", label: "SOPs", href: "/shreex/sops", noun: "procedures" },
    ],
  },
  {
    label: "Money",
    items: [
      { key: "finance", label: "Revenue", href: "/shreex/finance", noun: "entries" },
      { key: "expenses", label: "Expenses", href: "/shreex/finance", noun: "expenses" },
      { key: "cashflow", label: "Cashflow", href: "/shreex/finance", noun: "months" },
      { key: "vendors", label: "Vendors", href: "/shreex/vendors", noun: "vendors" },
    ],
  },
  {
    label: "Grow",
    items: [
      { key: "membership", label: "Membership", href: "/shreex/membership", noun: "members" },
      { key: "crm", label: "Leads", href: "/shreex/crm", noun: "leads" },
      { key: "partnerships", label: "Partnerships", href: "/shreex/partnerships", noun: "partners" },
      { key: "influencers", label: "Influencers", href: "/shreex/influencers", noun: "influencers" },
      { key: "ambassadors", label: "Ambassadors", href: "/shreex/ambassadors", noun: "ambassadors" },
    ],
  },
  {
    label: "Marketing",
    items: [
      { key: "campaigns", label: "Campaigns", href: "/shreex/campaigns", noun: "campaigns" },
      { key: "content", label: "Content", href: "/shreex/content", noun: "posts" },
      { key: "podcast", label: "Podcast", href: "/shreex/podcast", noun: "episodes" },
      { key: "competitors", label: "Competitors", href: "/shreex/competitors", noun: "competitors" },
    ],
  },
  {
    label: "Team",
    items: [
      { key: "people", label: "People", href: "/shreex/people", noun: "employees" },
      { key: "hiring", label: "Hiring", href: "/shreex/hiring", noun: "roles" },
      { key: "empkpis", label: "Employee KPIs", href: "/shreex/empkpis", noun: "KPIs" },
    ],
  },
  {
    label: "Product",
    items: [
      { key: "product", label: "Application", href: "/shreex/product", noun: "modules" },
      { key: "feedback", label: "Feedback", href: "/shreex/feedback", noun: "items" },
    ],
  },
  {
    label: "Govern",
    items: [
      { key: "approvals", label: "Approvals", href: "/shreex/approvals", noun: "requests" },
      { key: "risks", label: "Risks", href: "/shreex/risks", noun: "risks" },
      { key: "legal", label: "Legal", href: "/shreex/legal", noun: "obligations" },
      { key: "kpis", label: "KPI dictionary", href: "/shreex/kpis", noun: "definitions" },
      { key: "assets", label: "Assets", href: "/shreex/assets", noun: "assets" },
      { key: "inventory", label: "Inventory", href: "/shreex/inventory", noun: "items" },
      { key: "audit", label: "Audit log", href: "/shreex/audit", noun: "entries" },
    ],
  },
];
