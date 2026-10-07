import { createClient } from "@/lib/supabase/server";
import { requireSection } from "@/lib/os-access";
import { loadDirectory } from "@/lib/os-directory";
import { FeedbackClient, type Feedback } from "./FeedbackClient";

export const metadata = { title: "Feedback · Shreex" };

export default async function FeedbackPage() {
  await requireSection("product");
  const supabase = await createClient();
  const [{ data: rows }, people] = await Promise.all([
    supabase.from("feedback").select("*").order("created_at", { ascending: false }),
    loadDirectory(supabase),
  ]);
  return <FeedbackClient rows={(rows as Feedback[]) ?? []} people={people} />;
}
