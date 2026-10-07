import { createClient } from "@/lib/supabase/server";
import { requireSection } from "@/lib/os-access";
import { CompetitorsClient, type Competitor } from "./CompetitorsClient";

export const metadata = { title: "Competitors · Shreex" };

export default async function CompetitorsPage() {
  await requireSection("marketing");
  const supabase = await createClient();
  const { data } = await supabase.from("competitors").select("*").order("name");
  return <CompetitorsClient competitors={(data as Competitor[]) ?? []} />;
}
