"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { mailTaskReviewed } from "@/lib/task-mail";

const schema = z.object({
  period_type: z.enum(["week", "month"]),
  period_start: z.string().min(1),
  what_worked: z.string().trim().optional().nullable(),
  what_failed: z.string().trim().optional().nullable(),
  why_text: z.string().trim().optional().nullable(),
  corrective_action: z.string().trim().optional().nullable(),
  next_priority: z.string().trim().optional().nullable(),
});

/** Upsert the qualitative retrospective for a week/month. Metrics are computed
 * live on the page — only these notes persist. */
export async function saveReview(input: unknown) {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  if (!(await isAdmin())) return { error: "Not authorised" };

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reviews")
    .upsert(parsed.data, { onConflict: "tenant_id,period_type,period_start" })
    .select()
    .maybeSingle();
  if (error) return { error: error.message };

  await supabase.from("audit_log").insert({
    user_id: user.id,
    action: "upsert",
    entity: "reviews",
    entity_id: data?.id ?? null,
    after: parsed.data,
  });

  revalidatePath("/shreex/reviews");
  return { success: true };
}

const taskReviewSchema = z.object({
  task_id: z.string().uuid(),
  outcome: z.enum(["pending", "met", "partial", "missed"]),
  actual_hours: z.coerce.number().min(0).optional().nullable(),
  quality: z.coerce.number().int().min(1).max(5).optional().nullable(),
  what_worked: z.string().trim().optional().nullable(),
  what_failed: z.string().trim().optional().nullable(),
  learning: z.string().trim().optional().nullable(),
});

/**
 * Fill in the review a task opened when it completed. The estimate was
 * snapshotted at completion, so recording actual hours here is what makes the
 * estimate-vs-actual variance real. Anything left `pending` keeps showing up on
 * the dashboard as outstanding.
 */
export async function saveTaskReview(input: unknown) {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const parsed = taskReviewSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { task_id, ...fields } = parsed.data;

  const supabase = await createClient();
  // The retro on a piece of work belongs to whoever did it. An admin may
  // review anything; anyone else, only the tasks they own.
  if (!(await isAdmin())) {
    const { data: owned } = await supabase
      .from("tasks")
      .select("id")
      .eq("id", task_id)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (!owned) return { error: "Not authorised" };
  }
  const { error } = await supabase
    .from("task_reviews")
    .update({
      ...fields,
      // A review stops being outstanding the moment someone records an outcome.
      reviewed_by: user.id,
      reviewed_at: fields.outcome === "pending" ? null : new Date().toISOString(),
    })
    .eq("task_id", task_id);
  if (error) {
    return {
      error: error.message.includes("task_reviews")
        ? "Run migration 0011 in Supabase first."
        : error.message,
    };
  }

  // Keep the task's own hours in step, so the tasks table reads correctly too.
  if (fields.actual_hours != null) {
    await supabase.from("tasks").update({ actual_hours: fields.actual_hours }).eq("id", task_id);
  }

  await supabase.from("audit_log").insert({
    user_id: user.id,
    action: "upsert",
    entity: "task_reviews",
    entity_id: task_id,
    after: fields,
  });

  if (fields.outcome !== "pending") {
    await mailTaskReviewed({
      taskId: task_id,
      outcome: fields.outcome,
      quality: fields.quality ?? null,
      learning: fields.learning ?? null,
      byId: user.id,
    });
  }

  revalidatePath("/shreex/reviews");
  revalidatePath("/shreex");
  return { success: true };
}
