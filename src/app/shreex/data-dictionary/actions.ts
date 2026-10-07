"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";

const PATH = "/shreex/data-dictionary";

async function requireGovern() {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" as const };
  const supabase = await createClient();
  const { data } = await supabase.rpc("bos_can_access", { p_section: "govern" });
  if (data !== true && !(await isAdmin())) return { error: "Not authorised" as const };
  return { user, supabase };
}

const schema = z.object({
  table_name: z.string().trim().min(1, "Which table?"),
  column_name: z.string().trim().min(1, "Which column?"),
  description: z.string().trim().optional().nullable(),
  classification: z.enum(["public", "internal", "confidential", "personal"]).default("internal"),
  is_personal: z.coerce.boolean().default(false),
  lawful_basis: z.string().trim().optional().nullable(),
  retention_days: z.coerce.number().int().min(0).optional().nullable(),
  source_system: z.string().trim().optional().nullable(),
  owner_id: z.string().uuid().or(z.literal("")).transform((v) => v || null).optional().nullable(),
  notes: z.string().trim().optional().nullable(),
});

export async function saveField(id: string | null, input: unknown) {
  const gate = await requireGovern();
  if ("error" in gate) return gate;
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  // Anything classed as personal is personal, whichever box was ticked. Two
  // fields that can disagree is how a dictionary stops being trusted.
  const row = {
    ...parsed.data,
    is_personal: parsed.data.classification === "personal" ? true : parsed.data.is_personal,
    retention_days: parsed.data.retention_days ?? null,
    updated_at: new Date().toISOString(),
  };

  const { error } = id
    ? await gate.supabase.from("data_fields").update(row).eq("id", id)
    : await gate.supabase.from("data_fields").insert(row);
  if (error) {
    return {
      error: error.code === "23505"
        ? "That column is already in the dictionary."
        : error.message,
    };
  }
  revalidatePath(PATH);
  return { success: true };
}

export async function deleteField(id: string) {
  const gate = await requireGovern();
  if ("error" in gate) return gate;
  const { error } = await gate.supabase.from("data_fields").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { success: true };
}
