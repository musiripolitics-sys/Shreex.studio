"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";

const PATH = "/shreex/complaints";

async function requireGovern() {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" as const };
  const supabase = await createClient();
  const { data } = await supabase.rpc("bos_can_access", { p_section: "govern" });
  if (data !== true && !(await isAdmin())) return { error: "Not authorised" as const };
  return { user, supabase };
}

const schema = z.object({
  subject: z.string().trim().min(1, "A subject is required"),
  detail: z.string().trim().optional().nullable(),
  channel: z.string().trim().optional().nullable(),
  complainant: z.string().trim().optional().nullable(),
  contact_email: z.string().email().or(z.literal("")).transform((v) => v || null).optional().nullable(),
  severity: z.coerce.number().int().min(1).max(4).default(3),
  owner_id: z.string().uuid().or(z.literal("")).transform((v) => v || null).optional().nullable(),
  event_id: z.string().uuid().or(z.literal("")).transform((v) => v || null).optional().nullable(),
  root_cause: z.string().trim().optional().nullable(),
  resolution: z.string().trim().optional().nullable(),
});

export async function saveComplaint(id: string | null, input: unknown) {
  const gate = await requireGovern();
  if ("error" in gate) return gate;
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const { error } = id
    ? await gate.supabase.from("complaints").update(parsed.data).eq("id", id)
    : await gate.supabase.from("complaints").insert(parsed.data);
  if (error) return { error: error.message };

  revalidatePath(PATH);
  return { success: true };
}

/**
 * Move it along. The deadlines and the stamps are the database's job — the
 * trigger sets acknowledged_at the moment it leaves "new", so an
 * acknowledgement cannot be backdated by forgetting to record it.
 */
export async function setComplaintState(id: string, state: string) {
  const gate = await requireGovern();
  if ("error" in gate) return gate;
  const allowed = ["new", "acknowledged", "investigating", "awaiting", "resolved", "closed"];
  if (!allowed.includes(state)) return { error: "Unknown state" };

  const { error } = await gate.supabase.from("complaints").update({ state }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { success: true };
}
