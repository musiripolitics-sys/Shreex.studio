import { createClient } from "@/lib/supabase/server";
import { requireSection } from "@/lib/os-access";
import { loadDirectory } from "@/lib/os-directory";
import { EmployeeKpisClient, type EmployeeKpi } from "./EmployeeKpisClient";

export const metadata = { title: "Employee KPIs · Shreex" };

export default async function EmployeeKpisPage() {
  await requireSection("team");
  const supabase = await createClient();
  const [{ data: kpis }, people] = await Promise.all([
    supabase.from("employee_kpis").select("*").order("period", { ascending: false, nullsFirst: false }),
    loadDirectory(supabase),
  ]);
  return <EmployeeKpisClient kpis={(kpis as EmployeeKpi[]) ?? []} people={people} />;
}
