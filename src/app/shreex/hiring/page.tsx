import { createClient } from "@/lib/supabase/server";
import { requireSection } from "@/lib/os-access";
import { loadDirectory } from "@/lib/os-directory";
import { HiringClient, type Role } from "./HiringClient";

export const metadata = { title: "Hiring · Shreex" };

export default async function HiringPage() {
  await requireSection("team");
  const supabase = await createClient();
  const [{ data: roles }, people] = await Promise.all([
    supabase.from("hiring_plan").select("*").order("target_month", { nullsFirst: false }),
    loadDirectory(supabase),
  ]);
  return <HiringClient roles={(roles as Role[]) ?? []} people={people} />;
}
