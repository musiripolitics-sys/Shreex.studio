import { createClient } from "@/lib/supabase/server";
import { FinanceClient } from "./FinanceClient";
import type { Expense, RevenueEntry, CashflowMonth } from "./types";
import type { Workstream } from "../roadmap/types";
import { requireSection } from "@/lib/os-access";

export const metadata = { title: "Finance · Shreex" };

export default async function FinancePage() {
  await requireSection("money");
  const supabase = await createClient();

  const [
    { data: expenses },
    { data: revenue },
    { data: cashflow },
    { data: payments },
    { data: workstreams },
    { data: events },
  ] = await Promise.all([
    supabase.from("expenses").select("*").order("spent_on", { ascending: false }),
    supabase.from("revenue_entries").select("*").order("received_on", { ascending: false }),
    supabase.from("cashflow_months").select("*").order("month", { ascending: true }),
    // Revenue that already flows through the payments table (tickets, membership,
    // sponsorship) — summed into the finance view so nothing is double-counted.
    supabase.from("payments").select("amount,stream,created_at").eq("status", "paid"),
    supabase.from("workstreams").select("id,key,name,color").order("sort_order"),
    supabase.from("events").select("id,title").order("date", { ascending: false }).limit(200),
  ]);

  return (
    <FinanceClient
      expenses={(expenses as Expense[]) ?? []}
      revenue={(revenue as RevenueEntry[]) ?? []}
      cashflow={(cashflow as CashflowMonth[]) ?? []}
      payments={(payments as { amount: number; stream: string; created_at: string }[]) ?? []}
      workstreams={(workstreams as Workstream[]) ?? []}
      events={(events as { id: string; title: string }[]) ?? []}
    />
  );
}
