import { createClient } from "@/lib/supabase/server";
import { requireSection } from "@/lib/os-access";
import { loadDirectory } from "@/lib/os-directory";
import { isAdmin } from "@/lib/auth";
import { getCurrentUser } from "@/lib/auth";
import { SopsClient, type SopDoc, type SopVersion, type SopStep, type SopRun, type SopRunItem } from "./SopsClient";

export const metadata = { title: "SOPs & Quality · Shreex" };

/**
 * Procedures, and the evidence they were followed.
 *
 * Everything loads at once — a handful of documents with a handful of
 * versions each is not worth a round trip per panel, and it makes opening one
 * instant.
 */
export default async function SopsPage() {
  // SOPs sit under Events in the nav, so that is the grant that opens them.
  // Guarding on anything else would lock out the people who run the events
  // these procedures are about.
  await requireSection("events");
  const supabase = await createClient();
  const user = await getCurrentUser();

  const [
    { data: docs },
    { data: versions },
    { data: steps },
    { data: acks },
    { data: runs },
    { data: items },
    { data: events },
    directory,
    admin,
  ] = await Promise.all([
    supabase.from("sop_documents").select("*").order("code", { nullsFirst: false }),
    supabase.from("sop_versions").select("*").order("version", { ascending: false }),
    supabase.from("sop_steps").select("*").order("sort_order"),
    supabase.from("sop_acknowledgements").select("version_id,user_id,acknowledged_at"),
    supabase.from("sop_runs").select("*").order("started_at", { ascending: false }).limit(200),
    supabase.from("sop_run_items").select("*"),
    supabase.from("events").select("id,title,date").order("date", { ascending: false }).limit(100),
    loadDirectory(supabase),
    isAdmin(),
  ]);

  return (
    <SopsClient
      docs={(docs as SopDoc[]) ?? []}
      versions={(versions as SopVersion[]) ?? []}
      steps={(steps as SopStep[]) ?? []}
      acks={(acks as { version_id: string; user_id: string; acknowledged_at: string }[]) ?? []}
      runs={(runs as SopRun[]) ?? []}
      runItems={(items as SopRunItem[]) ?? []}
      events={(events as { id: string; title: string; date: string }[]) ?? []}
      people={directory}
      isAdmin={admin}
      meId={user?.id ?? null}
    />
  );
}
