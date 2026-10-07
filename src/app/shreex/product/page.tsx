import { createClient } from "@/lib/supabase/server";
import { requireSection } from "@/lib/os-access";
import { loadDirectory } from "@/lib/os-directory";
import { ProductClient, type Module } from "./ProductClient";

export const metadata = { title: "Product · Shreex" };

export default async function ProductPage() {
  await requireSection("product");
  const supabase = await createClient();
  const [{ data: modules }, people] = await Promise.all([
    supabase.from("app_modules").select("*").order("module"),
    loadDirectory(supabase),
  ]);
  return <ProductClient modules={(modules as Module[]) ?? []} people={people} />;
}
