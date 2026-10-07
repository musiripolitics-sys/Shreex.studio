import { createClient } from "@/lib/supabase/server";
import { requireSection } from "@/lib/os-access";
import { loadDirectory } from "@/lib/os-directory";
import { DictionaryClient, type DataField } from "./DictionaryClient";

export const metadata = { title: "Data dictionary · Shreex" };

export default async function DataDictionaryPage() {
  await requireSection("govern");
  const supabase = await createClient();

  const [{ data: fields }, people] = await Promise.all([
    supabase.from("data_fields").select("*").order("table_name").order("column_name"),
    loadDirectory(supabase),
  ]);

  return <DictionaryClient fields={(fields as DataField[]) ?? []} people={people} />;
}
