import { createClient } from "@/lib/supabase/server";
import { requireSection } from "@/lib/os-access";
import { productLabels } from "@/lib/os-products";
import { loadDirectory } from "@/lib/os-directory";
import { PeopleClient, type Member } from "./PeopleClient";

export const metadata = { title: "People · Shreex" };

/**
 * The team, assembled from the four places a person exists: their account,
 * their profile, what they can open, and what they are carrying.
 */
export default async function PeoplePage() {
  await requireSection("team");
  const supabase = await createClient();

  const [{ data: profiles }, { data: access }, { data: tasks }, { data: kpis }, people, labels] =
    await Promise.all([
      supabase.from("employee_profiles").select("*"),
      supabase.from("employee_module_access").select("user_id,section"),
      supabase.from("tasks").select("owner_id,status,due_date"),
      supabase.from("employee_kpis").select("employee_id,target,actual"),
      loadDirectory(supabase),
      productLabels(),
    ]);

  const prof = new Map(((profiles as Record<string, unknown>[]) ?? []).map((p) => [p.user_id as string, p]));
  const today = new Date().toISOString().slice(0, 10);

  const members: Member[] = people.map((p) => {
    const mine = ((tasks as { owner_id: string | null; status: string; due_date: string | null }[]) ?? [])
      .filter((t) => t.owner_id === p.id);
    const open = mine.filter((t) => t.status !== "completed" && t.status !== "cancelled");
    const pr = prof.get(p.id) as Record<string, unknown> | undefined;
    const theirKpis = ((kpis as { employee_id: string; target: number | null; actual: number | null }[]) ?? [])
      .filter((k) => k.employee_id === p.id);

    return {
      id: p.id,
      full_name: p.full_name,
      email: p.email,
      role: p.primary_role ?? null,
      title: (pr?.title as string) ?? null,
      department: (pr?.department as string) ?? null,
      manager_id: (pr?.manager_id as string) ?? null,
      start_date: (pr?.start_date as string) ?? null,
      monthly_cost: (pr?.monthly_cost as number) ?? 0,
      status: (pr?.status as string) ?? null,
      sections: ((access as { user_id: string; section: string }[]) ?? [])
        .filter((a) => a.user_id === p.id)
        // Names from the catalogue, so a renamed product reads the same here
        // as it does in the sidebar.
        .map((a) => labels[a.section] ?? a.section),
      openTasks: open.length,
      overdueTasks: open.filter((t) => t.due_date && t.due_date < today).length,
      kpiCount: theirKpis.length,
      kpiMeasured: theirKpis.filter((k) => k.actual != null).length,
    };
  });

  return <PeopleClient members={members} />;
}
