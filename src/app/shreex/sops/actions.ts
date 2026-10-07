"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";

const PATH = "/shreex/sops";

async function requireAdminUser() {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" as const };
  if (!(await isAdmin())) return { error: "Only an admin can change a procedure." as const };
  return { user, supabase: await createClient() };
}

const docSchema = z.object({
  code: z.string().trim().optional().nullable(),
  title: z.string().trim().min(1, "A title is required"),
  purpose: z.string().trim().optional().nullable(),
  category: z.string().trim().optional().nullable(),
  owner_id: z.string().uuid().or(z.literal("")).transform((v) => v || null).optional().nullable(),
  review_every_days: z.coerce.number().int().min(1).max(3650).default(180),
});

/** A new procedure starts as a document with an empty first draft. */
export async function saveSop(id: string | null, input: unknown) {
  const gate = await requireAdminUser();
  if ("error" in gate) return gate;
  const parsed = docSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const { supabase, user } = gate;
  if (id) {
    const { error } = await supabase
      .from("sop_documents")
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return { error: error.message };
  } else {
    const { data, error } = await supabase
      .from("sop_documents")
      .insert(parsed.data)
      .select("id")
      .maybeSingle();
    if (error) return { error: error.message };
    const sopId = (data as { id: string } | null)?.id;
    if (sopId) {
      await supabase.from("sop_versions").insert({
        sop_id: sopId,
        version: 1,
        body: "",
        change_note: "First draft",
        author_id: user.id,
      });
    }
  }
  revalidatePath(PATH);
  return { success: true };
}

/**
 * Start a new draft from the current version.
 *
 * Editing an approved version in place would silently invalidate every
 * acknowledgement against it — people would be recorded as having read
 * something they never saw. So a change is always a new version.
 */
export async function draftNewVersion(sopId: string) {
  const gate = await requireAdminUser();
  if ("error" in gate) return gate;
  const { supabase, user } = gate;

  const { data: latest } = await supabase
    .from("sop_versions")
    .select("id,version,body")
    .eq("sop_id", sopId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const prev = latest as { id: string; version: number; body: string | null } | null;
  const { data: created, error } = await supabase
    .from("sop_versions")
    .insert({
      sop_id: sopId,
      version: (prev?.version ?? 0) + 1,
      body: prev?.body ?? "",
      author_id: user.id,
    })
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };

  // Carry the steps over, or every new version starts from nothing.
  if (prev?.id && created) {
    const { data: steps } = await supabase
      .from("sop_steps")
      .select("sort_order,instruction,pass_criteria,needs_evidence")
      .eq("version_id", prev.id)
      .order("sort_order");
    const rows = ((steps as Record<string, unknown>[]) ?? []).map((s) => ({
      ...s,
      version_id: (created as { id: string }).id,
    }));
    if (rows.length) await supabase.from("sop_steps").insert(rows);
  }

  revalidatePath(PATH);
  return { success: true };
}

const versionSchema = z.object({
  body: z.string().optional().nullable(),
  change_note: z.string().trim().optional().nullable(),
});

export async function saveVersion(versionId: string, input: unknown) {
  const gate = await requireAdminUser();
  if ("error" in gate) return gate;
  const parsed = versionSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const { data: v } = await gate.supabase
    .from("sop_versions")
    .select("approved_at")
    .eq("id", versionId)
    .maybeSingle();
  if ((v as { approved_at: string | null } | null)?.approved_at) {
    return { error: "That version is approved. Start a new draft to change it." };
  }

  const { error } = await gate.supabase.from("sop_versions").update(parsed.data).eq("id", versionId);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { success: true };
}

export async function saveSteps(
  versionId: string,
  steps: { instruction: string; pass_criteria?: string | null; needs_evidence?: boolean }[],
) {
  const gate = await requireAdminUser();
  if ("error" in gate) return gate;

  const { data: v } = await gate.supabase
    .from("sop_versions")
    .select("approved_at")
    .eq("id", versionId)
    .maybeSingle();
  if ((v as { approved_at: string | null } | null)?.approved_at) {
    return { error: "That version is approved. Start a new draft to change it." };
  }

  await gate.supabase.from("sop_steps").delete().eq("version_id", versionId);
  const rows = steps
    .filter((s) => s.instruction.trim())
    .map((s, i) => ({
      version_id: versionId,
      sort_order: i + 1,
      instruction: s.instruction.trim(),
      pass_criteria: s.pass_criteria?.trim() || null,
      needs_evidence: !!s.needs_evidence,
    }));
  if (rows.length) {
    const { error } = await gate.supabase.from("sop_steps").insert(rows);
    if (error) return { error: error.message };
  }
  revalidatePath(PATH);
  return { success: true };
}

/** Approving a version is what publishes the document. */
export async function publishVersion(versionId: string) {
  const gate = await requireAdminUser();
  if ("error" in gate) return gate;
  const { error } = await gate.supabase.rpc("bos_publish_sop", { p_version: versionId });
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { success: true };
}

/** "I have read this version." Anyone, for themselves only. */
export async function acknowledgeVersion(versionId: string) {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("sop_acknowledgements")
    .insert({ version_id: versionId, user_id: user.id });
  // Saying so twice is not an error worth showing anybody.
  if (error && error.code !== "23505") return { error: error.message };
  revalidatePath(PATH);
  return { success: true };
}

/** Start carrying a procedure out, optionally against an event. */
export async function startRun(sopId: string, versionId: string, label: string, eventId?: string | null) {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("sop_runs")
    .insert({
      sop_id: sopId,
      version_id: versionId,
      label: label.trim() || null,
      event_id: eventId || null,
      run_by: user.id,
    })
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };

  // Seed an item per step so the checklist exists before anybody ticks it.
  const { data: steps } = await supabase.from("sop_steps").select("id").eq("version_id", versionId);
  const runId = (data as { id: string } | null)?.id;
  if (runId && steps?.length) {
    await supabase
      .from("sop_run_items")
      .insert((steps as { id: string }[]).map((s) => ({ run_id: runId, step_id: s.id })));
  }
  revalidatePath(PATH);
  return { success: true, runId };
}

export async function setRunItem(
  itemId: string,
  state: "pending" | "pass" | "fail" | "na",
  note?: string | null,
  evidenceUrl?: string | null,
) {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("sop_run_items")
    .update({
      state,
      note: note?.trim() || null,
      evidence_url: evidenceUrl?.trim() || null,
      checked_by: user.id,
      checked_at: new Date().toISOString(),
    })
    .eq("id", itemId);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { success: true };
}

export async function finishRun(runId: string) {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("sop_runs")
    .update({ completed_at: new Date().toISOString() })
    .eq("id", runId);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { success: true };
}
