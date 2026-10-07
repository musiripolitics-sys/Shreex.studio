export type Expense = {
  id: string;
  category: string;
  subcategory: string | null;
  description: string | null;
  amount: number; // paise
  spent_on: string;
  vendor: string | null;
  workstream_id: string | null;
  approval_status: "pending" | "approved" | "rejected";
  payment_status: "unpaid" | "paid";
  recurring: boolean;
  created_at: string;
};

export type RevenueEntry = {
  id: string;
  source: string;
  description: string | null;
  amount: number; // paise
  received_on: string;
  related_event_id: string | null;
  workstream_id: string | null;
  created_at: string;
};

export type CashflowMonth = {
  id: string;
  month: string;
  scenario: "base" | "conservative" | "growth";
  opening_cash: number;
  revenue_forecast: number;
  marketing_spend: number;
  event_cost: number;
  payroll: number;
  hiring_cost: number;
  technology_cost: number;
  other_expenses: number;
};

export const EXPENSE_CATEGORIES = [
  "Marketing",
  "Events",
  "Technology",
  "Software",
  "Hosting",
  "Salaries",
  "Hiring",
  "Vendors",
  "Travel",
  "Equipment",
  "Legal",
  "Operations",
  "Office",
  "Partnerships",
  "Other",
] as const;

export const REVENUE_SOURCES = [
  "membership",
  "ticket",
  "sponsorship",
  "service",
  "other",
] as const;
