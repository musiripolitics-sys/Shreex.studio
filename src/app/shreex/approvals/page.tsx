import { createClient } from "@/lib/supabase/server";
import { MODULES } from "@/lib/os-modules";
import { ModuleTable, type RefOptions } from "@/components/os/ModuleTable";
import { ApprovalsWorkflow, type Approval } from "./ApprovalsWorkflow";

export const metadata = { title: "Approvals · Shreex" };

export default async function ApprovalsPage() {
  const config = MODULES.approvals;
  const supabase = await createClient();

  const [{ data: rows }, { data: owners }] = await Promise.all([
    supabase.from("approvals").select("*").order("created_at", { ascending: false }),
    supabase.from("users").select("id,full_name,email").order("full_name").limit(500),
  ]);

  const approvals = (rows as Approval[]) ?? [];
  const options: RefOptions = {
    owners: (owners as RefOptions["owners"]) ?? [],
    workstreams: [],
    events: [],
    goals: [],
    campaigns: [],
  };

  return (
    <>
      <ApprovalsWorkflow rows={approvals} owners={options.owners} />
      <div className="mt-8">
        <ModuleTable config={config} rows={approvals as (Approval & { id: string })[]} options={options} />
      </div>
    </>
  );
}
