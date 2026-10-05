"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";

/** Team and Product writes. One gate each, since they are separate grants. */
async function gate(section: "team" | "product") {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" as const };
  const supabase = await createClient();
  const { data } = await supabase.rpc("bos_can_access", { p_section: section });
  if (data !== true && !(await isAdmin())) return { error: "Not authorised" as const };
  return { user, supabase };
}

const touch = (...paths: string[]) => paths.forEach((p) => revalidatePath(`/admin/os/${p}`));
const nullableUuid = z.string().uuid().or(z.literal("")).transform((v) => v || null).optional().nullable();
const nullableDate = z.string().optional().nullable().transform((v) => v || null);
const STATUSES = ["not_started", "in_progress", "blocked", "completed", "on_hold", "cancelled"] as const;

// ──────────────────────────────── People ────────────────────────────────

const profileSchema = z.object({
  user_id: z.string().uuid(),
  title: z.string().trim().optional().nullable(),
  department: z.string().trim().optional().nullable(),
  manager_id: nullableUuid,
  start_date: nullableDate,
  monthly_cost: z.coerce.number().int().min(0).default(0),
  status: z.string().trim().default("active"),
});

export async function saveProfile(input: unknown) {
  const g = await gate("team");
  if ("error" in g) return g;
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  // One profile per person, so this is an upsert on the person rather than an
  // insert that would quietly create a second.
  const { error } = await g.supabase
    .from("employee_profiles")
    .upsert(parsed.data, { onConflict: "user_id" });
  if (error) return { error: error.message };
  touch("people", "empkpis");
  return { success: true };
}

// ──────────────────────────────── Hiring ────────────────────────────────

const roleSchema = z.object({
  role: z.string().trim().min(1, "Which role?"),
  department: z.string().trim().optional().nullable(),
  reason: z.string().trim().optional().nullable(),
  expected_output: z.string().trim().optional().nullable(),
  target_month: nullableDate,
  start_date: nullableDate,
  monthly_cost: z.coerce.number().int().min(0).default(0),
  one_time_cost: z.coerce.number().int().min(0).default(0),
  recruitment_budget: z.coerce.number().int().min(0).default(0),
  owner_id: nullableUuid,
  status: z.enum(STATUSES).default("not_started"),
});

export async function saveRole(id: string | null, input: unknown) {
  const g = await gate("team");
  if ("error" in g) return g;
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const { error } = id
    ? await g.supabase.from("hiring_plan").update(parsed.data).eq("id", id)
    : await g.supabase.from("hiring_plan").insert(parsed.data);
  if (error) return { error: error.message };
  touch("hiring");
  return { success: true };
}

export async function setRoleStatus(id: string, status: string) {
  const g = await gate("team");
  if ("error" in g) return g;
  if (!(STATUSES as readonly string[]).includes(status)) return { error: "Unknown status" };
  const { error } = await g.supabase.from("hiring_plan").update({ status }).eq("id", id);
  if (error) return { error: error.message };
  touch("hiring");
  return { success: true };
}

// ───────────────────────────── Employee KPIs ─────────────────────────────

const kpiSchema = z.object({
  employee_id: z.string().uuid(),
  kpi_name: z.string().trim().min(1, "What is being measured?"),
  period: nullableDate,
  target: z.coerce.number().optional().nullable(),
  actual: z.coerce.number().optional().nullable(),
});

export async function saveEmployeeKpi(id: string | null, input: unknown) {
  const g = await gate("team");
  if ("error" in g) return g;
  const parsed = kpiSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const { error } = id
    ? await g.supabase.from("employee_kpis").update(parsed.data).eq("id", id)
    : await g.supabase.from("employee_kpis").insert(parsed.data);
  if (error) return { error: error.message };
  touch("empkpis");
  return { success: true };
}

/**
 * Record what actually happened.
 *
 * Every KPI in this system has a target and no actual, which is the normal
 * fate of a measure that takes a form to update. This is the one-field write
 * the page needs so recording a number costs a keystroke.
 */
export async function setKpiActual(id: string, actual: string) {
  const g = await gate("team");
  if ("error" in g) return g;
  const value = actual === "" ? null : Number(actual);
  if (value !== null && Number.isNaN(value)) return { error: "That is not a number" };
  const { error } = await g.supabase.from("employee_kpis").update({ actual: value }).eq("id", id);
  if (error) return { error: error.message };
  touch("empkpis");
  return { success: true };
}

// ──────────────────────────────── Product ────────────────────────────────

const moduleSchema = z.object({
  module: z.string().trim().min(1, "Which module?"),
  feature: z.string().trim().optional().nullable(),
  user_story: z.string().trim().optional().nullable(),
  owner_id: nullableUuid,
  developer: z.string().trim().optional().nullable(),
  qa: z.string().trim().optional().nullable(),
  environment: z.string().trim().optional().nullable(),
  status: z.enum(STATUSES).default("not_started"),
  priority: z.enum(["critical", "high", "medium", "low"]).default("medium"),
  bug_count: z.coerce.number().int().min(0).default(0),
  release: z.string().trim().optional().nullable(),
  target_date: nullableDate,
});

export async function saveModule(id: string | null, input: unknown) {
  const g = await gate("product");
  if ("error" in g) return g;
  const parsed = moduleSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const { error } = id
    ? await g.supabase.from("app_modules").update(parsed.data).eq("id", id)
    : await g.supabase.from("app_modules").insert(parsed.data);
  if (error) return { error: error.message };
  touch("product");
  return { success: true };
}

/** Promote a module to the next environment, straight from the board. */
export async function setModuleEnvironment(id: string, environment: string) {
  const g = await gate("product");
  if ("error" in g) return g;
  if (!["development", "staging", "production"].includes(environment)) {
    return { error: "Unknown environment" };
  }
  const { error } = await g.supabase.from("app_modules").update({ environment }).eq("id", id);
  if (error) return { error: error.message };
  touch("product");
  return { success: true };
}

// ──────────────────────────────── Feedback ────────────────────────────────

const feedbackSchema = z.object({
  source_type: z.string().trim().optional().nullable(),
  rating: z.coerce.number().int().min(1).max(5).optional().nullable(),
  feedback: z.string().trim().min(1, "What did they say?"),
  issue: z.string().trim().optional().nullable(),
  owner_id: nullableUuid,
  action: z.string().trim().optional().nullable(),
  resolution: z.string().trim().optional().nullable(),
  retention_risk: z.string().trim().optional().nullable(),
});

export async function saveFeedback(id: string | null, input: unknown) {
  const g = await gate("product");
  if ("error" in g) return g;
  const parsed = feedbackSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const { error } = id
    ? await g.supabase.from("feedback").update(parsed.data).eq("id", id)
    : await g.supabase.from("feedback").insert(parsed.data);
  if (error) return { error: error.message };
  touch("feedback");
  return { success: true };
}
