import { createClient } from "@/lib/supabase/server";
import { requireSection } from "@/lib/os-access";
import { loadDirectory } from "@/lib/os-directory";
import { CampaignsClient, type Campaign } from "./CampaignsClient";

export const metadata = { title: "Campaigns · Shreex" };

export default async function CampaignsPage() {
  await requireSection("marketing");
  const supabase = await createClient();

  const [{ data: campaigns }, { data: content }, people] = await Promise.all([
    supabase.from("campaigns").select("*").order("start_date", { ascending: false, nullsFirst: false }),
    // What each campaign is actually made of.
    supabase.from("content_items").select("id,campaign_id,status,reach,leads"),
    loadDirectory(supabase),
  ]);

  return (
    <CampaignsClient
      campaigns={(campaigns as Campaign[]) ?? []}
      content={(content as { id: string; campaign_id: string | null; status: string; reach: number | null; leads: number | null }[]) ?? []}
      people={people}
    />
  );
}
