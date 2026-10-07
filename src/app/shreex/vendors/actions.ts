"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";

const PATH = "/shreex/vendors";

async function requireMoney() {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" as const };
  const supabase = await createClient();
  const { data } = await supabase.rpc("bos_can_access", { p_section: "money" });
  if (data !== true && !(await isAdmin())) return { error: "Not authorised" as const };
  return { user, supabase };
}

const schema = z.object({
  name: z.string().trim().min(1, "A name is required"),
  category: z.string().trim().optional().nullable(),
  service: z.string().trim().optional().nullable(),
  contact: z.string().trim().optional().nullable(),
  contract: z.string().trim().optional().nullable(),
  monthly_cost: z.coerce.number().int().min(0).default(0),
  start_date: z.string().optional().nullable(),
  end_date: z.string().optional().nullable(),
  status: z.string().trim().optional().nullable(),
  performance: z.coerce.number().int().min(1).max(5).optional().nullable(),
  owner_id: z.string().uuid().or(z.literal("")).transform((v) => v || null).optional().nullable(),
});

export async function saveVendor(id: string | null, input: unknown) {
  const gate = await requireMoney();
  if ("error" in gate) return gate;
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const row = {
    ...parsed.data,
    start_date: parsed.data.start_date || null,
    end_date: parsed.data.end_date || null,
    performance: parsed.data.performance ?? null,
  };

  const { error } = id
    ? await gate.supabase.from("vendors").update(row).eq("id", id)
    : await gate.supabase.from("vendors").insert(row);
  if (error) return { error: error.message };

  revalidatePath(PATH);
  revalidatePath("/shreex/finance");
  return { success: true };
}

export async function setVendorStatus(id: string, status: string) {
  const gate = await requireMoney();
  if ("error" in gate) return gate;
  const { error } = await gate.supabase.from("vendors").update({ status }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { success: true };
}
