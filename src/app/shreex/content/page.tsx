import { createClient } from "@/lib/supabase/server";
import { requireSection } from "@/lib/os-access";
import { loadDirectory } from "@/lib/os-directory";
import { ContentClient, type ContentItem } from "./ContentClient";

export const metadata = { title: "Content calendar · Shreex" };

export default async function ContentPage() {
  await requireSection("marketing");
  const supabase = await createClient();

  const [{ data: items }, { data: campaigns }, people] = await Promise.all([
    supabase.from("content_items").select("*").order("content_date", { nullsFirst: false }),
    supabase.from("campaigns").select("id,name").order("created_at", { ascending: false }),
    loadDirectory(supabase),
  ]);

  return (
    <ContentClient
      items={(items as ContentItem[]) ?? []}
      campaigns={(campaigns as { id: string; name: string }[]) ?? []}
      people={people}
    />
  );
}
