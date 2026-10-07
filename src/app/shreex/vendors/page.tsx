import { createClient } from "@/lib/supabase/server";
import { requireSection } from "@/lib/os-access";
import { loadDirectory } from "@/lib/os-directory";
import { VendorsClient, type Vendor } from "./VendorsClient";

export const metadata = { title: "Vendors · Shreex" };

export default async function VendorsPage() {
  await requireSection("money");
  const supabase = await createClient();

  const [{ data: vendors }, { data: expenses }, people] = await Promise.all([
    supabase.from("vendors").select("*").order("name"),
    // What we have actually paid them, which is not always what the contract says.
    supabase.from("expenses").select("vendor,amount,spent_on"),
    loadDirectory(supabase),
  ]);

  return (
    <VendorsClient
      vendors={(vendors as Vendor[]) ?? []}
      expenses={(expenses as { vendor: string | null; amount: number; spent_on: string }[]) ?? []}
      people={people}
    />
  );
}
