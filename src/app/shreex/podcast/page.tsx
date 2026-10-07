import { createClient } from "@/lib/supabase/server";
import { requireSection } from "@/lib/os-access";
import { PodcastClient, type Episode } from "./PodcastClient";

export const metadata = { title: "Podcast · Shreex" };

export default async function PodcastPage() {
  await requireSection("marketing");
  const supabase = await createClient();
  const { data } = await supabase
    .from("podcast_episodes")
    .select("*")
    .order("number", { ascending: false, nullsFirst: false });

  return <PodcastClient episodes={(data as Episode[]) ?? []} />;
}
