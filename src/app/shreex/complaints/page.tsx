import { createClient } from "@/lib/supabase/server";
import { requireSection } from "@/lib/os-access";
import { loadDirectory } from "@/lib/os-directory";
import { ComplaintsClient, type Complaint } from "./ComplaintsClient";
import type { Change } from "@/components/os/ChangeHistory";

export const metadata = { title: "Complaints · Shreex" };

export default async function ComplaintsPage() {
  await requireSection("govern");
  const supabase = await createClient();

  const [{ data: rows }, { data: changes }, { data: events }, people] = await Promise.all([
    supabase.from("complaints").select("*").order("received_at", { ascending: false }),
    supabase
      .from("govern_changes")
      .select("*")
      .eq("entity", "complaints")
      .order("changed_at", { ascending: false })
      .limit(500),
    supabase.from("events").select("id,title,date").order("date", { ascending: false }).limit(100),
    loadDirectory(supabase),
  ]);

  return (
    <ComplaintsClient
      rows={(rows as Complaint[]) ?? []}
      changes={(changes as Change[]) ?? []}
      events={(events as { id: string; title: string; date: string }[]) ?? []}
      people={people}
    />
  );
}
