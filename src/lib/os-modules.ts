/**
 * Business OS — configuration-driven modules.
 *
 * Each record module (campaigns, CRM, risks, vendors, …) is described here as
 * data: which table it maps to, the table columns to show, and the form fields
 * to edit. One generic Server Action + one generic client component read this,
 * so a new module is a config entry, not a new page. Money fields are entered
 * in rupees and converted to paise at the action boundary.
 *
 * Universal file — no server-only imports (used by both the client table and
 * the server action).
 */

export type RefKind = "workstream" | "owner" | "event" | "goal" | "campaign";

export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "money"
  | "date"
  | "select"
  | "checkbox"
  | "status"
  | "priority"
  | "frequency"
  | "stage"
  | RefKind;

export type Field = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: readonly string[];
  span2?: boolean;
  placeholder?: string;
};

export type ColumnType =
  | "text"
  | "money"
  | "date"
  | "number"
  | "status"
  | "priority"
  | "stage"
  | "workstream"
  | "owner"
  | "pct"
  | "bool"
  | "chip";

export type Column = {
  key: string;
  label: string;
  type?: ColumnType;
  align?: "right";
  sub?: string; // secondary line key
};

export type ModuleConfig = {
  key: string;
  table: string;
  title: string;
  desc: string;
  icon: string;
  group: string;
  columns: Column[];
  fields: Field[];
  filters?: ("status" | "priority" | "stage")[];
  order?: { col: string; asc: boolean };
  readOnly?: boolean;
  refs?: RefKind[]; // which option lists the page must load
};

// Shared option lists
const CHANNELS = [
  "Instagram", "LinkedIn", "YouTube", "WhatsApp", "Email", "College Outreach",
  "Influencer Marketing", "Community Marketing", "Guerrilla Marketing",
  "Event Marketing", "Partnership Marketing", "Podcast", "Paid Advertising",
] as const;

const CAMPAIGN_TYPES = [
  "awareness", "engagement", "lead_gen", "membership", "event_reg", "revenue", "retention",
] as const;

const CONTENT_TYPES = [
  "Post", "Carousel", "Reel", "Short", "Story", "Video", "Poll", "Article",
  "Testimonial", "Event Promotion", "Membership Promotion", "Community Content",
] as const;

const PLATFORMS = ["Instagram", "LinkedIn", "YouTube", "WhatsApp", "Email", "Website"] as const;

const PARTNER_TYPES = [
  "College", "Corporate", "Technology", "Media", "Community", "Event Vendor",
  "Sponsor", "Influencer", "Startup", "Educational Institution",
] as const;

const ENVIRONMENTS = ["development", "qa", "staging", "production"] as const;
const APPROVAL_TYPES = ["Event", "Host", "Expense", "Campaign", "Partnership", "Hiring", "Content", "Payment"] as const;
const APPROVAL_DECISIONS = ["pending", "approved", "rejected"] as const;
const FEEDBACK_SOURCES = ["member", "attendee", "host", "client", "partner", "ambassador"] as const;
const RETENTION_RISK = ["low", "medium", "high"] as const;
const EXPENSE_CATS = [
  "Marketing", "Events", "Technology", "Software", "Hosting", "Salaries",
  "Hiring", "Vendors", "Travel", "Equipment", "Legal", "Operations", "Office", "Partnerships", "Other",
] as const;
const ASSET_TYPES = [
  "Brand", "Social", "Event", "Marketing", "Legal", "Finance", "Product", "SOP", "Presentation", "Video", "Podcast",
] as const;

export const MODULES: Record<string, ModuleConfig> = {
  campaigns: {
    key: "campaigns", table: "campaigns", title: "Marketing Campaigns",
    desc: "Every campaign with its budget, reach, leads, conversions and ROI.",
    icon: "broadcast", group: "Marketing", filters: ["status"], refs: ["owner", "workstream"],
    order: { col: "created_at", asc: false },
    columns: [
      { key: "name", label: "Campaign", sub: "channel" },
      { key: "campaign_type", label: "Type", type: "chip" },
      { key: "owner_id", label: "Owner", type: "owner" },
      { key: "actual_spend", label: "Spend", type: "money", align: "right" },
      { key: "actual_leads", label: "Leads", type: "number", align: "right" },
      { key: "revenue_generated", label: "Revenue", type: "money", align: "right" },
      { key: "status", label: "Status", type: "status" },
    ],
    fields: [
      { key: "name", label: "Campaign name", type: "text", required: true, span2: true },
      { key: "channel", label: "Channel", type: "select", options: CHANNELS },
      { key: "campaign_type", label: "Type", type: "select", options: CAMPAIGN_TYPES },
      { key: "objective", label: "Objective", type: "text", span2: true },
      { key: "audience", label: "Target audience", type: "text" },
      { key: "owner_id", label: "Owner", type: "owner" },
      { key: "workstream_id", label: "Workstream", type: "workstream" },
      { key: "status", label: "Status", type: "status" },
      { key: "start_date", label: "Start date", type: "date" },
      { key: "end_date", label: "End date", type: "date" },
      { key: "budget", label: "Budget (₹)", type: "money" },
      { key: "actual_spend", label: "Actual spend (₹)", type: "money" },
      { key: "target_reach", label: "Target reach", type: "number" },
      { key: "actual_reach", label: "Actual reach", type: "number" },
      { key: "target_leads", label: "Target leads", type: "number" },
      { key: "actual_leads", label: "Actual leads", type: "number" },
      { key: "target_conversions", label: "Target conversions", type: "number" },
      { key: "actual_conversions", label: "Actual conversions", type: "number" },
      { key: "revenue_generated", label: "Revenue generated (₹)", type: "money" },
    ],
  },

  content: {
    key: "content", table: "content_items", title: "Content Calendar",
    desc: "Plan and track every social post, reel and article.",
    icon: "calendar", group: "Marketing", filters: ["status"], refs: ["owner", "campaign"],
    order: { col: "content_date", asc: false },
    columns: [
      { key: "content_date", label: "Date", type: "date" },
      { key: "platform", label: "Platform", type: "chip" },
      { key: "content_type", label: "Type", type: "chip" },
      { key: "topic", label: "Topic", sub: "pillar" },
      { key: "owner_id", label: "Owner", type: "owner" },
      { key: "reach", label: "Reach", type: "number", align: "right" },
      { key: "status", label: "Status", type: "status" },
    ],
    fields: [
      { key: "content_date", label: "Date", type: "date", required: true },
      { key: "platform", label: "Platform", type: "select", options: PLATFORMS },
      { key: "content_type", label: "Content type", type: "select", options: CONTENT_TYPES },
      { key: "topic", label: "Topic", type: "text", span2: true },
      { key: "pillar", label: "Content pillar", type: "text" },
      { key: "campaign_id", label: "Campaign", type: "campaign" },
      { key: "audience", label: "Audience", type: "text" },
      { key: "cta", label: "Call to action", type: "text" },
      { key: "owner_id", label: "Owner", type: "owner" },
      { key: "status", label: "Status", type: "status" },
      { key: "asset_url", label: "Asset URL", type: "text", span2: true },
      { key: "reach", label: "Reach", type: "number" },
      { key: "engagement", label: "Engagement", type: "number" },
      { key: "leads", label: "Leads", type: "number" },
      { key: "conversions", label: "Conversions", type: "number" },
    ],
  },

  podcast: {
    key: "podcast", table: "podcast_episodes", title: "Podcast",
    desc: "Episodes, guests, editing/publishing status and distribution.",
    icon: "mic", group: "Marketing",
    order: { col: "number", asc: false },
    columns: [
      { key: "number", label: "#", type: "number" },
      { key: "title", label: "Episode", sub: "guest" },
      { key: "recording_date", label: "Recorded", type: "date" },
      { key: "publishing_status", label: "Publishing", type: "chip" },
      { key: "views", label: "Views", type: "number", align: "right" },
      { key: "shorts_published", label: "Shorts", type: "number", align: "right" },
    ],
    fields: [
      { key: "number", label: "Episode #", type: "number" },
      { key: "title", label: "Title", type: "text", required: true, span2: true },
      { key: "guest", label: "Guest", type: "text" },
      { key: "topic", label: "Topic", type: "text" },
      { key: "recording_date", label: "Recording date", type: "date" },
      { key: "editing_status", label: "Editing status", type: "text" },
      { key: "publishing_status", label: "Publishing status", type: "text" },
      { key: "youtube_status", label: "YouTube status", type: "text" },
      { key: "shorts_target", label: "Shorts target", type: "number" },
      { key: "shorts_published", label: "Shorts published", type: "number" },
      { key: "views", label: "Views", type: "number" },
      { key: "engagement", label: "Engagement", type: "number" },
      { key: "leads", label: "Leads", type: "number" },
      { key: "conversions", label: "Conversions", type: "number" },
      { key: "budget", label: "Budget (₹)", type: "money" },
      { key: "actual_cost", label: "Actual cost (₹)", type: "money" },
    ],
  },

  crm: {
    key: "crm", table: "leads", title: "Sales / CRM",
    desc: "Pipeline from lead to won. Weighted = expected revenue × probability.",
    icon: "trophy", group: "Sales", filters: ["stage"], refs: ["owner", "campaign"],
    order: { col: "created_at", asc: false },
    columns: [
      { key: "name", label: "Lead", sub: "company" },
      { key: "source", label: "Source", type: "chip" },
      { key: "owner_id", label: "Owner", type: "owner" },
      { key: "expected_revenue", label: "Expected", type: "money", align: "right" },
      { key: "probability", label: "Prob", type: "pct", align: "right" },
      { key: "weighted_revenue", label: "Weighted", type: "money", align: "right" },
      { key: "stage", label: "Stage", type: "stage" },
    ],
    fields: [
      { key: "name", label: "Lead / contact name", type: "text", required: true },
      { key: "company", label: "Company", type: "text" },
      { key: "contact", label: "Contact (email/phone)", type: "text" },
      { key: "source", label: "Source", type: "text" },
      { key: "requirement", label: "Requirement", type: "textarea", span2: true },
      { key: "expected_revenue", label: "Expected revenue (₹)", type: "money" },
      { key: "probability", label: "Probability (%)", type: "number" },
      { key: "owner_id", label: "Owner", type: "owner" },
      { key: "campaign_id", label: "Campaign", type: "campaign" },
      { key: "next_follow_up", label: "Next follow-up", type: "date" },
      { key: "stage", label: "Stage", type: "stage" },
    ],
  },

  partnerships: {
    key: "partnerships", table: "partnerships", title: "Partnerships",
    desc: "Partners, stage, value and ROI.",
    icon: "nodes", group: "Community", filters: ["status"], refs: ["owner"],
    order: { col: "created_at", asc: false },
    columns: [
      { key: "name", label: "Partner", sub: "partner_type" },
      { key: "owner_id", label: "Owner", type: "owner" },
      { key: "stage", label: "Stage", type: "chip" },
      { key: "expected_value", label: "Expected", type: "money", align: "right" },
      { key: "actual_value", label: "Actual", type: "money", align: "right" },
      { key: "status", label: "Status", type: "status" },
    ],
    fields: [
      { key: "name", label: "Partner name", type: "text", required: true, span2: true },
      { key: "partner_type", label: "Type", type: "select", options: PARTNER_TYPES },
      { key: "contact", label: "Contact", type: "text" },
      { key: "owner_id", label: "Owner", type: "owner" },
      { key: "stage", label: "Stage", type: "text" },
      { key: "status", label: "Status", type: "status" },
      { key: "start_date", label: "Start date", type: "date" },
      { key: "end_date", label: "End date", type: "date" },
      { key: "expected_value", label: "Expected value (₹)", type: "money" },
      { key: "actual_value", label: "Actual value (₹)", type: "money" },
      { key: "cost", label: "Cost (₹)", type: "money" },
      { key: "next_action", label: "Next action", type: "text", span2: true },
    ],
  },

  influencers: {
    key: "influencers", table: "influencers", title: "Influencers",
    desc: "Influencer CRM — reach, collaborations, members and revenue generated.",
    icon: "sparkle", group: "Community", refs: ["owner"],
    order: { col: "created_at", asc: false },
    columns: [
      { key: "name", label: "Influencer", sub: "platform" },
      { key: "category", label: "Category", type: "chip" },
      { key: "followers", label: "Followers", type: "number", align: "right" },
      { key: "members_generated", label: "Members", type: "number", align: "right" },
      { key: "revenue_generated", label: "Revenue", type: "money", align: "right" },
      { key: "status", label: "Status", type: "chip" },
    ],
    fields: [
      { key: "name", label: "Name", type: "text", required: true, span2: true },
      { key: "platform", label: "Platform", type: "text" },
      { key: "category", label: "Category", type: "text" },
      { key: "followers", label: "Followers / reach", type: "number" },
      { key: "engagement", label: "Engagement (%)", type: "number" },
      { key: "collaboration_type", label: "Collaboration type", type: "text" },
      { key: "status", label: "Status", type: "text" },
      { key: "owner_id", label: "Owner", type: "owner" },
      { key: "budget", label: "Budget (₹)", type: "money" },
      { key: "actual_cost", label: "Actual cost (₹)", type: "money" },
      { key: "leads", label: "Leads", type: "number" },
      { key: "conversions", label: "Conversions", type: "number" },
      { key: "members_generated", label: "Members generated", type: "number" },
      { key: "revenue_generated", label: "Revenue generated (₹)", type: "money" },
    ],
  },

  ambassadors: {
    key: "ambassadors", table: "ambassadors", title: "College Ambassadors",
    desc: "College-wise ambassador program performance.",
    icon: "medal", group: "Community", refs: ["owner"],
    order: { col: "created_at", asc: false },
    columns: [
      { key: "student_name", label: "Ambassador", sub: "college" },
      { key: "city", label: "City", type: "chip" },
      { key: "events_promoted", label: "Events", type: "number", align: "right" },
      { key: "registrations", label: "Regs", type: "number", align: "right" },
      { key: "members_acquired", label: "Members", type: "number", align: "right" },
      { key: "status", label: "Status", type: "chip" },
    ],
    fields: [
      { key: "student_name", label: "Student name", type: "text", required: true },
      { key: "college", label: "College", type: "text", required: true },
      { key: "city", label: "City", type: "text" },
      { key: "contact", label: "Contact", type: "text" },
      { key: "status", label: "Status", type: "text" },
      { key: "start_date", label: "Start date", type: "date" },
      { key: "owner_id", label: "Owner", type: "owner" },
      { key: "events_promoted", label: "Events promoted", type: "number" },
      { key: "leads", label: "Leads", type: "number" },
      { key: "registrations", label: "Registrations", type: "number" },
      { key: "members_acquired", label: "Members acquired", type: "number" },
    ],
  },

  people: {
    key: "people", table: "employee_profiles", title: "People",
    desc: "Employee profiles, departments, managers and monthly cost.",
    icon: "users", group: "People", refs: ["owner"],
    order: { col: "created_at", asc: false },
    columns: [
      { key: "user_id", label: "Employee", type: "owner" },
      { key: "title", label: "Title", sub: "department" },
      { key: "manager_id", label: "Manager", type: "owner" },
      { key: "monthly_cost", label: "Monthly cost", type: "money", align: "right" },
      { key: "status", label: "Status", type: "chip" },
    ],
    fields: [
      { key: "user_id", label: "User (existing account)", type: "owner", required: true },
      { key: "title", label: "Title", type: "text" },
      { key: "department", label: "Department", type: "text" },
      { key: "manager_id", label: "Manager", type: "owner" },
      { key: "start_date", label: "Start date", type: "date" },
      { key: "monthly_cost", label: "Monthly cost (₹)", type: "money" },
      { key: "status", label: "Status", type: "text" },
    ],
  },

  hiring: {
    key: "hiring", table: "hiring_plan", title: "Hiring Plan",
    desc: "Planned roles with financial impact.",
    icon: "rocket", group: "People", filters: ["status"], refs: ["owner"],
    order: { col: "target_month", asc: true },
    columns: [
      { key: "role", label: "Role", sub: "department" },
      { key: "target_month", label: "Target", type: "date" },
      { key: "monthly_cost", label: "Monthly", type: "money", align: "right" },
      { key: "one_time_cost", label: "One-time", type: "money", align: "right" },
      { key: "status", label: "Status", type: "status" },
    ],
    fields: [
      { key: "role", label: "Role", type: "text", required: true },
      { key: "department", label: "Department", type: "text" },
      { key: "reason", label: "Reason", type: "textarea", span2: true },
      { key: "target_month", label: "Target hire month", type: "date" },
      { key: "monthly_cost", label: "Monthly cost (₹)", type: "money" },
      { key: "one_time_cost", label: "One-time hiring cost (₹)", type: "money" },
      { key: "recruitment_budget", label: "Recruitment budget (₹)", type: "money" },
      { key: "start_date", label: "Start date", type: "date" },
      { key: "status", label: "Status", type: "status" },
      { key: "owner_id", label: "Owner", type: "owner" },
      { key: "expected_output", label: "Expected output", type: "textarea", span2: true },
    ],
  },

  product: {
    key: "product", table: "app_modules", title: "Application Development",
    desc: "Product control center — modules, features, environment and bugs.",
    icon: "code", group: "Product", filters: ["status", "priority"], refs: ["owner"],
    order: { col: "created_at", asc: false },
    columns: [
      { key: "module", label: "Module", sub: "feature" },
      { key: "environment", label: "Env", type: "chip" },
      { key: "owner_id", label: "Owner", type: "owner" },
      { key: "bug_count", label: "Bugs", type: "number", align: "right" },
      { key: "priority", label: "Priority", type: "priority" },
      { key: "status", label: "Status", type: "status" },
    ],
    fields: [
      { key: "module", label: "Module", type: "text", required: true },
      { key: "feature", label: "Feature", type: "text" },
      { key: "user_story", label: "User story", type: "textarea", span2: true },
      { key: "owner_id", label: "Owner", type: "owner" },
      { key: "developer", label: "Developer", type: "text" },
      { key: "qa", label: "QA", type: "text" },
      { key: "environment", label: "Environment", type: "select", options: ENVIRONMENTS },
      { key: "status", label: "Status", type: "status" },
      { key: "priority", label: "Priority", type: "priority" },
      { key: "bug_count", label: "Bug count", type: "number" },
      { key: "release", label: "Release", type: "text" },
      { key: "target_date", label: "Target date", type: "date" },
    ],
  },

  approvals: {
    key: "approvals", table: "approvals", title: "Approvals",
    desc: "Approval workflow for events, expenses, campaigns, hiring and more.",
    icon: "check", group: "Governance", refs: ["owner"],
    order: { col: "created_at", asc: false },
    columns: [
      { key: "request_title", label: "Request", sub: "request_type" },
      { key: "requester_id", label: "Requester", type: "owner" },
      { key: "amount", label: "Amount", type: "money", align: "right" },
      { key: "decision", label: "Decision", type: "chip" },
    ],
    fields: [
      { key: "request_type", label: "Type", type: "select", options: APPROVAL_TYPES, required: true },
      { key: "request_title", label: "Request title", type: "text", required: true, span2: true },
      { key: "requester_id", label: "Requester", type: "owner" },
      { key: "approver_id", label: "Approver", type: "owner" },
      { key: "amount", label: "Amount (₹)", type: "money" },
      { key: "decision", label: "Decision", type: "select", options: APPROVAL_DECISIONS },
      { key: "comments", label: "Comments", type: "textarea", span2: true },
    ],
  },

  risks: {
    key: "risks", table: "risks", title: "Risks & Issues",
    desc: "Risk register. Score = impact × likelihood (auto).",
    icon: "wrench", group: "Governance", filters: ["status"], refs: ["owner"],
    order: { col: "created_at", asc: false },
    columns: [
      { key: "risk", label: "Risk", sub: "area" },
      { key: "owner_id", label: "Owner", type: "owner" },
      { key: "impact", label: "Impact", type: "number", align: "right" },
      { key: "likelihood", label: "Likelihood", type: "number", align: "right" },
      { key: "risk_score", label: "Score", type: "number", align: "right" },
      { key: "status", label: "Status", type: "status" },
    ],
    fields: [
      { key: "risk", label: "Risk", type: "text", required: true, span2: true },
      { key: "area", label: "Area", type: "text" },
      { key: "impact", label: "Impact (1–5)", type: "number" },
      { key: "likelihood", label: "Likelihood (1–5)", type: "number" },
      { key: "owner_id", label: "Owner", type: "owner" },
      { key: "status", label: "Status", type: "status" },
      { key: "mitigation", label: "Mitigation", type: "textarea", span2: true },
      { key: "due_date", label: "Due date", type: "date" },
    ],
  },

  legal: {
    key: "legal", table: "legal_items", title: "Legal & Compliance",
    desc: "Compliance requirements, documents, expiry and renewal.",
    icon: "book", group: "Governance", filters: ["status"], refs: ["owner"],
    order: { col: "due_date", asc: true },
    columns: [
      { key: "requirement", label: "Requirement", sub: "risk" },
      { key: "owner_id", label: "Owner", type: "owner" },
      { key: "due_date", label: "Due", type: "date" },
      { key: "expiry_date", label: "Expiry", type: "date" },
      { key: "status", label: "Status", type: "status" },
    ],
    fields: [
      { key: "requirement", label: "Requirement", type: "text", required: true, span2: true },
      { key: "owner_id", label: "Owner", type: "owner" },
      { key: "status", label: "Status", type: "status" },
      { key: "risk", label: "Risk", type: "text" },
      { key: "due_date", label: "Due date", type: "date" },
      { key: "expiry_date", label: "Expiry date", type: "date" },
      { key: "renewal_date", label: "Renewal date", type: "date" },
      { key: "document_url", label: "Document URL", type: "text", span2: true },
    ],
  },

  sops: {
    key: "sops", table: "sops", title: "SOPs & Quality",
    desc: "Standard operating procedures and quality checks.",
    icon: "book", group: "Governance", filters: ["status"], refs: ["owner"],
    order: { col: "created_at", asc: false },
    columns: [
      { key: "process", label: "Process", sub: "step" },
      { key: "owner_id", label: "Owner", type: "owner" },
      { key: "next_review", label: "Next review", type: "date" },
      { key: "status", label: "Status", type: "status" },
    ],
    fields: [
      { key: "process", label: "Process", type: "text", required: true, span2: true },
      { key: "step", label: "Step", type: "text", span2: true },
      { key: "owner_id", label: "Owner", type: "owner" },
      { key: "frequency", label: "Frequency", type: "frequency" },
      { key: "quality_check", label: "Quality check", type: "textarea", span2: true },
      { key: "pass_criteria", label: "Pass criteria", type: "text", span2: true },
      { key: "evidence_url", label: "Evidence URL", type: "text" },
      { key: "last_reviewed", label: "Last reviewed", type: "date" },
      { key: "next_review", label: "Next review", type: "date" },
      { key: "status", label: "Status", type: "status" },
    ],
  },

  vendors: {
    key: "vendors", table: "vendors", title: "Vendors",
    desc: "Vendor contracts, monthly cost and performance.",
    icon: "nodes", group: "Operations", refs: ["owner"],
    order: { col: "created_at", asc: false },
    columns: [
      { key: "name", label: "Vendor", sub: "service" },
      { key: "category", label: "Category", type: "chip" },
      { key: "monthly_cost", label: "Monthly", type: "money", align: "right" },
      { key: "status", label: "Status", type: "chip" },
    ],
    fields: [
      { key: "name", label: "Vendor name", type: "text", required: true, span2: true },
      { key: "category", label: "Category", type: "text" },
      { key: "contact", label: "Contact", type: "text" },
      { key: "service", label: "Service", type: "text", span2: true },
      { key: "contract", label: "Contract (ref/URL)", type: "text", span2: true },
      { key: "start_date", label: "Start date", type: "date" },
      { key: "end_date", label: "End date", type: "date" },
      { key: "monthly_cost", label: "Monthly cost (₹)", type: "money" },
      { key: "status", label: "Status", type: "text" },
      { key: "owner_id", label: "Owner", type: "owner" },
      { key: "performance", label: "Performance", type: "text" },
    ],
  },

  assets: {
    key: "assets", table: "assets", title: "Assets & Documents",
    desc: "Asset repository index — brand, marketing, legal and product assets.",
    icon: "book", group: "Operations", refs: ["owner", "workstream"],
    order: { col: "created_at", asc: false },
    columns: [
      { key: "name", label: "Asset", sub: "type" },
      { key: "owner_id", label: "Owner", type: "owner" },
      { key: "version", label: "Version", type: "chip" },
      { key: "review_date", label: "Review", type: "date" },
      { key: "status", label: "Status", type: "chip" },
    ],
    fields: [
      { key: "name", label: "Asset name", type: "text", required: true, span2: true },
      { key: "type", label: "Type", type: "select", options: ASSET_TYPES },
      { key: "workstream_id", label: "Workstream", type: "workstream" },
      { key: "owner_id", label: "Owner", type: "owner" },
      { key: "version", label: "Version", type: "text" },
      { key: "status", label: "Status", type: "text" },
      { key: "link", label: "Link", type: "text", span2: true },
      { key: "created_date", label: "Created date", type: "date" },
      { key: "review_date", label: "Review date", type: "date" },
    ],
  },

  inventory: {
    key: "inventory", table: "inventory", title: "Inventory & Equipment",
    desc: "Items, quantity, value, location and condition.",
    icon: "ticket", group: "Operations", refs: ["owner"],
    order: { col: "created_at", asc: false },
    columns: [
      { key: "item", label: "Item", sub: "category" },
      { key: "quantity", label: "Qty", type: "number", align: "right" },
      { key: "total_value", label: "Value", type: "money", align: "right" },
      { key: "assigned_to", label: "Assigned", type: "owner" },
      { key: "status", label: "Status", type: "chip" },
    ],
    fields: [
      { key: "item", label: "Item", type: "text", required: true, span2: true },
      { key: "category", label: "Category", type: "text" },
      { key: "quantity", label: "Quantity", type: "number" },
      { key: "unit_cost", label: "Unit cost (₹)", type: "money" },
      { key: "location", label: "Location", type: "text" },
      { key: "assigned_to", label: "Assigned to", type: "owner" },
      { key: "condition", label: "Condition", type: "text" },
      { key: "purchase_date", label: "Purchase date", type: "date" },
      { key: "status", label: "Status", type: "text" },
    ],
  },

  competitors: {
    key: "competitors", table: "competitors", title: "Competitor Tracking",
    desc: "Market and competitor observations. Facts only — no assumptions.",
    icon: "users", group: "Operations",
    order: { col: "created_at", asc: false },
    columns: [
      { key: "name", label: "Competitor", sub: "category" },
      { key: "pricing", label: "Pricing", type: "chip" },
      { key: "review_date", label: "Reviewed", type: "date" },
    ],
    fields: [
      { key: "name", label: "Competitor", type: "text", required: true, span2: true },
      { key: "category", label: "Category", type: "text" },
      { key: "offer", label: "Offer", type: "textarea", span2: true },
      { key: "business_model", label: "Business model", type: "text" },
      { key: "pricing", label: "Pricing", type: "text" },
      { key: "target_audience", label: "Target audience", type: "text" },
      { key: "strengths", label: "Observed strengths", type: "textarea", span2: true },
      { key: "gaps", label: "Observed gaps", type: "textarea", span2: true },
      { key: "our_response", label: "Our response", type: "textarea", span2: true },
      { key: "review_date", label: "Review date", type: "date" },
    ],
  },

  feedback: {
    key: "feedback", table: "feedback", title: "Feedback & Retention",
    desc: "Feedback from members, attendees, hosts, clients and partners.",
    icon: "broadcast", group: "Operations", refs: ["owner"],
    order: { col: "created_at", asc: false },
    columns: [
      { key: "source_type", label: "Source", type: "chip" },
      { key: "rating", label: "Rating", type: "number", align: "right" },
      { key: "feedback", label: "Feedback", sub: "issue" },
      { key: "retention_risk", label: "Retention risk", type: "chip" },
    ],
    fields: [
      { key: "source_type", label: "Source", type: "select", options: FEEDBACK_SOURCES, required: true },
      { key: "rating", label: "Rating (1–5)", type: "number" },
      { key: "feedback", label: "Feedback", type: "textarea", span2: true },
      { key: "issue", label: "Issue", type: "text", span2: true },
      { key: "owner_id", label: "Owner", type: "owner" },
      { key: "action", label: "Action", type: "text", span2: true },
      { key: "resolution", label: "Resolution", type: "text", span2: true },
      { key: "retention_risk", label: "Retention risk", type: "select", options: RETENTION_RISK },
    ],
  },

  kpis: {
    key: "kpis", table: "kpis", title: "Data Dictionary",
    desc: "Every KPI defined once — name, definition, formula, source, owner.",
    icon: "book", group: "Governance", refs: ["owner"],
    order: { col: "name", asc: true },
    columns: [
      { key: "name", label: "KPI", sub: "definition" },
      { key: "formula", label: "Formula", type: "chip" },
      { key: "source", label: "Source", type: "chip" },
      { key: "owner_id", label: "Owner", type: "owner" },
      { key: "unit", label: "Unit", type: "chip" },
    ],
    fields: [
      { key: "name", label: "KPI name", type: "text", required: true, span2: true },
      { key: "definition", label: "Definition", type: "textarea", span2: true },
      { key: "formula", label: "Formula", type: "text", span2: true },
      { key: "source", label: "Source", type: "text" },
      { key: "owner_id", label: "Owner", type: "owner" },
      { key: "frequency", label: "Update frequency", type: "frequency" },
      { key: "unit", label: "Unit", type: "text" },
    ],
  },

  audit: {
    key: "audit", table: "audit_log", title: "Audit Log",
    desc: "Every important Business OS action, most recent first.",
    icon: "clock", group: "Governance", readOnly: true, refs: ["owner"],
    order: { col: "created_at", asc: false },
    columns: [
      { key: "created_at", label: "When", type: "date" },
      { key: "user_id", label: "User", type: "owner" },
      { key: "action", label: "Action", type: "chip" },
      { key: "entity", label: "Entity", type: "chip" },
    ],
    fields: [],
  },
};

export const EXPENSE_CATEGORIES = EXPENSE_CATS;

/** Modules in sidebar order, grouped. Used to build OS navigation. */
export const MODULE_ORDER: string[] = [
  "campaigns", "content", "podcast",
  "crm",
  "partnerships", "influencers", "ambassadors",
  "people", "hiring",
  "product",
  "approvals", "risks", "legal", "sops", "kpis", "audit",
  "vendors", "assets", "inventory", "competitors", "feedback",
];

export type NavItem = { href: string; label: string; icon: string };
export type NavSection = { label: string; items: NavItem[] };

const m = (key: string): NavItem => ({
  href: `/admin/os/${key}`,
  label: MODULES[key].title,
  icon: MODULES[key].icon,
});

/** Grouped navigation for the Business OS module bar. */
export const OS_SECTIONS: NavSection[] = [
  {
    label: "Overview",
    items: [
      { href: "/admin/os", label: "Dashboard", icon: "home" },
      { href: "/admin/os/roadmap", label: "90-Day Roadmap", icon: "rocket" },
      { href: "/admin/os/tasks", label: "Tasks", icon: "check" },
      { href: "/admin/os/calendar", label: "Calendar", icon: "calendar" },
    ],
  },
  { label: "Money", items: [{ href: "/admin/os/finance", label: "Finance", icon: "trophy" }] },
  { label: "Marketing", items: [m("campaigns"), m("content"), m("podcast")] },
  {
    label: "Growth",
    items: [
      m("crm"),
      { href: "/admin/os/membership", label: "Membership", icon: "medal" },
      m("partnerships"),
      m("influencers"),
      m("ambassadors"),
    ],
  },
  { label: "People", items: [m("people"), m("hiring")] },
  { label: "Product", items: [m("product")] },
  { label: "Governance", items: [m("approvals"), m("risks"), m("legal"), m("sops"), m("kpis"), m("audit")] },
  { label: "Operations", items: [m("vendors"), m("assets"), m("inventory"), m("competitors"), m("feedback")] },
  {
    label: "Insights",
    items: [
      { href: "/admin/os/analytics", label: "Analytics", icon: "nodes" },
      { href: "/admin/os/reports", label: "Reports", icon: "book" },
      { href: "/admin/os/alerts", label: "Alerts", icon: "bell" },
    ],
  },
];
