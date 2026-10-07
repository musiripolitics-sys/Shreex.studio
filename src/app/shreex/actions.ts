"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import {
  mailTaskAssigned, mailTaskDecision, mailTaskSubmitted,
} from "@/lib/task-mail";
import { sendEmployeeWelcome } from "@/lib/email";
import { productLabels } from "@/lib/os-products";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";

/**
 * Shreex mutations. Every write re-checks admin (defence in depth on top
 * of RLS), records an audit_log row, and revalidates the module so Server
 * Components repaint with fresh data. Money fields arrive already in paise —
 * the client converts rupees at the form boundary.
 */

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" as const };
  if (!(await isAdmin())) return { error: "Not authorised" as const };
  return { user };
}

async function logAudit(
  supabase: SupabaseServer,
  userId: string,
  action: string,
  entity: string,
  entityId: string | null,
  before: unknown,
  after: unknown,
) {
  await supabase.from("audit_log").insert({
    user_id: userId,
    action,
    entity,
    entity_id: entityId,
    before: before ?? null,
    after: after ?? null,
  });
}

const OS = "/shreex";
function revalidateOs() {
  revalidatePath(OS);
  revalidatePath(`${OS}/roadmap`);
  revalidatePath(`${OS}/tasks`);
  revalidatePath(`${OS}/finance`);
}

// ─────────────────────────── shared field schemas ───────────────────────────

const statusEnum = z.enum([
  "not_started",
  "in_progress",
  "blocked",
  "completed",
  "on_hold",
  "cancelled",
]);
const priorityEnum = z.enum(["critical", "high", "medium", "low"]);
const freqEnum = z.enum(["daily", "weekly", "monthly", "one_time"]);
const optDate = z.string().optional().nullable().transform((v) => v || null);
const optUuid = z
  .string()
  .uuid()
  .optional()
  .nullable()
  .or(z.literal(""))
  .transform((v) => (v ? v : null));

// ─────────────────────────────── Goals ───────────────────────────────

const goalSchema = z.object({
  objective: z.string().trim().min(2, "Objective is required"),
  deliverable: z.string().trim().optional().nullable(),
  workstream_id: optUuid,
  owner_id: optUuid,
  month: z.coerce.number().int().min(1).max(3).optional().nullable(),
  week: z.coerce.number().int().min(1).max(13).optional().nullable(),
  start_date: optDate,
  end_date: optDate,
  priority: priorityEnum.default("medium"),
  status: statusEnum.default("not_started"),
  budget: z.coerce.number().int().min(0).default(0),
  target_kpi: z.string().trim().optional().nullable(),
  actual_kpi: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
});

export async function saveGoal(id: string | null, input: unknown) {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;
  const parsed = goalSchema.safeParse(input);
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  if (id) {
    const { data: before } = await supabase.from("goals").select("*").eq("id", id).maybeSingle();
    const { data, error } = await supabase.from("goals").update(parsed.data).eq("id", id).select().maybeSingle();
    if (error) return { error: error.message };
    await logAudit(supabase, gate.user.id, "update", "goals", id, before, data);
  } else {
    const { data, error } = await supabase.from("goals").insert(parsed.data).select().maybeSingle();
    if (error) return { error: error.message };
    await logAudit(supabase, gate.user.id, "insert", "goals", data?.id ?? null, null, data);
  }
  revalidateOs();
  return { success: true };
}

export async function deleteGoal(id: string) {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;
  const supabase = await createClient();
  const { data: before } = await supabase.from("goals").select("*").eq("id", id).maybeSingle();
  const { error } = await supabase.from("goals").delete().eq("id", id);
  if (error) return { error: error.message };
  await logAudit(supabase, gate.user.id, "delete", "goals", id, before, null);
  revalidateOs();
  return { success: true };
}

// ─────────────────────────────── Tasks ───────────────────────────────

const taskSchema = z.object({
  title: z.string().trim().min(2, "Task title is required"),
  description: z.string().trim().optional().nullable(),
  workstream_id: optUuid,
  goal_id: optUuid,
  owner_id: optUuid,
  frequency: freqEnum.default("one_time"),
  start_date: optDate,
  due_date: optDate,
  status: statusEnum.default("not_started"),
  priority: priorityEnum.default("medium"),
  budget: z.coerce.number().int().min(0).default(0),
  actual_cost: z.coerce.number().int().min(0).default(0),
  target: z.coerce.number().optional().nullable(),
  actual: z.coerce.number().optional().nullable(),
  // Hours of work. The estimate is snapshotted into the task's review when the
  // task completes, which is what makes estimate-vs-actual answerable later.
  estimate_hours: z.coerce.number().min(0).optional().nullable(),
  actual_hours: z.coerce.number().min(0).optional().nullable(),
  comments: z.string().trim().optional().nullable(),
});

export async function saveTask(id: string | null, input: unknown) {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;
  const parsed = taskSchema.safeParse(input);
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  if (id) {
    const { data: before } = await supabase.from("tasks").select("*").eq("id", id).maybeSingle();
    const { data, error } = await supabase.from("tasks").update(parsed.data).eq("id", id).select().maybeSingle();
    if (error) return { error: error.message };
    await logAudit(supabase, gate.user.id, "update", "tasks", id, before, data);
    // Only a change of hands is news. Editing the budget on a task somebody
    // already owns is not worth an email.
    if (data && data.owner_id && data.owner_id !== before?.owner_id) {
      await mailTaskAssigned(data, gate.user.id);
    }
  } else {
    const { data, error } = await supabase.from("tasks").insert(parsed.data).select().maybeSingle();
    if (error) return { error: error.message };
    await logAudit(supabase, gate.user.id, "insert", "tasks", data?.id ?? null, null, data);
    if (data?.owner_id) await mailTaskAssigned(data, gate.user.id);
  }
  revalidateOs();
  return { success: true };
}

export async function setTaskStatus(id: string, status: z.infer<typeof statusEnum>) {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;
  if (!statusEnum.safeParse(status).success) return { error: "Invalid status" };
  const supabase = await createClient();
  const { error } = await supabase.from("tasks").update({ status }).eq("id", id);
  if (error) return { error: error.message };
  await logAudit(supabase, gate.user.id, "update", "tasks", id, null, { status });
  revalidateOs();
  return { success: true };
}

export async function deleteTask(id: string) {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;
  const supabase = await createClient();
  const { data: before } = await supabase.from("tasks").select("*").eq("id", id).maybeSingle();
  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) return { error: error.message };
  await logAudit(supabase, gate.user.id, "delete", "tasks", id, before, null);
  revalidateOs();
  return { success: true };
}

// ─────────────────────────────── Expenses ───────────────────────────────

const expenseSchema = z.object({
  category: z.string().trim().min(1, "Category is required"),
  subcategory: z.string().trim().optional().nullable(),
  description: z.string().trim().optional().nullable(),
  amount: z.coerce.number().int().min(0), // paise
  spent_on: z.string().min(1, "Date is required"),
  vendor: z.string().trim().optional().nullable(),
  workstream_id: optUuid,
  approval_status: z.enum(["pending", "approved", "rejected"]).default("pending"),
  payment_status: z.enum(["unpaid", "paid"]).default("unpaid"),
  recurring: z.coerce.boolean().default(false),
});

export async function saveExpense(id: string | null, input: unknown) {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;
  const parsed = expenseSchema.safeParse(input);
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const row = { ...parsed.data, owner_id: gate.user.id };
  if (id) {
    const { data: before } = await supabase.from("expenses").select("*").eq("id", id).maybeSingle();
    const { data, error } = await supabase.from("expenses").update(parsed.data).eq("id", id).select().maybeSingle();
    if (error) return { error: error.message };
    await logAudit(supabase, gate.user.id, "update", "expenses", id, before, data);
  } else {
    const { data, error } = await supabase.from("expenses").insert(row).select().maybeSingle();
    if (error) return { error: error.message };
    await logAudit(supabase, gate.user.id, "insert", "expenses", data?.id ?? null, null, data);
  }
  revalidateOs();
  return { success: true };
}

export async function deleteExpense(id: string) {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;
  const supabase = await createClient();
  const { data: before } = await supabase.from("expenses").select("*").eq("id", id).maybeSingle();
  const { error } = await supabase.from("expenses").delete().eq("id", id);
  if (error) return { error: error.message };
  await logAudit(supabase, gate.user.id, "delete", "expenses", id, before, null);
  revalidateOs();
  return { success: true };
}

// ─────────────────────────────── Revenue ───────────────────────────────

const revenueSchema = z.object({
  source: z.string().trim().min(1, "Source is required"),
  description: z.string().trim().optional().nullable(),
  amount: z.coerce.number().int().min(0), // paise
  received_on: z.string().min(1, "Date is required"),
  related_event_id: optUuid,
  workstream_id: optUuid,
});

export async function saveRevenue(id: string | null, input: unknown) {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;
  const parsed = revenueSchema.safeParse(input);
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  if (id) {
    const { data: before } = await supabase.from("revenue_entries").select("*").eq("id", id).maybeSingle();
    const { data, error } = await supabase.from("revenue_entries").update(parsed.data).eq("id", id).select().maybeSingle();
    if (error) return { error: error.message };
    await logAudit(supabase, gate.user.id, "update", "revenue_entries", id, before, data);
  } else {
    const { data, error } = await supabase.from("revenue_entries").insert(parsed.data).select().maybeSingle();
    if (error) return { error: error.message };
    await logAudit(supabase, gate.user.id, "insert", "revenue_entries", data?.id ?? null, null, data);
  }
  revalidateOs();
  return { success: true };
}

export async function deleteRevenue(id: string) {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;
  const supabase = await createClient();
  const { data: before } = await supabase.from("revenue_entries").select("*").eq("id", id).maybeSingle();
  const { error } = await supabase.from("revenue_entries").delete().eq("id", id);
  if (error) return { error: error.message };
  await logAudit(supabase, gate.user.id, "delete", "revenue_entries", id, before, null);
  revalidateOs();
  return { success: true };
}

// ─────────────────────────────── Cash flow ───────────────────────────────

const cashflowSchema = z.object({
  month: z.string().min(1, "Month is required"),
  scenario: z.enum(["base", "conservative", "growth"]).default("base"),
  opening_cash: z.coerce.number().int().default(0),
  revenue_forecast: z.coerce.number().int().default(0),
  marketing_spend: z.coerce.number().int().default(0),
  event_cost: z.coerce.number().int().default(0),
  payroll: z.coerce.number().int().default(0),
  hiring_cost: z.coerce.number().int().default(0),
  technology_cost: z.coerce.number().int().default(0),
  other_expenses: z.coerce.number().int().default(0),
});

export async function saveCashflow(input: unknown) {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;
  const parsed = cashflowSchema.safeParse(input);
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  // Upsert on the table's unique constraint, which gained tenant_id in
  // migration 0035 so two businesses can each have their own January.
  // tenant_id is not in the payload: the column default supplies it.
  const { data, error } = await supabase
    .from("cashflow_months")
    .upsert(parsed.data, { onConflict: "tenant_id,month,scenario" })
    .select()
    .maybeSingle();
  if (error) return { error: error.message };
  await logAudit(supabase, gate.user.id, "upsert", "cashflow_months", data?.id ?? null, null, data);
  revalidateOs();
  return { success: true };
}

// ─────────────────────── Roadmap → tasks ───────────────────────

/**
 * Turns every roadmap goal into a task. Each roadmap line is a unit of work, so
 * the goal's dates, owner, workstream and dependencies carry across and land on
 * the calendar as scheduled work. Goals that already produced a task are left
 * alone, so this is safe to press repeatedly.
 */
export async function syncRoadmapTasks() {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("bos_sync_roadmap_tasks");
  if (error) {
    return {
      error: error.message.includes("bos_sync_roadmap_tasks")
        ? "Run migration 0011 in Supabase first."
        : error.message,
    };
  }

  const created = typeof data === "number" ? data : 0;
  if (created > 0) {
    await logAudit(supabase, gate.user.id, "create", "tasks", null, null, {
      source: "roadmap",
      created,
    });
  }
  revalidateOs();
  return { success: true, created };
}

// ─────────────────────── Task detail panel ───────────────────────

/**
 * Admin, or the person this task is assigned to.
 *
 * An employee owns the work, so they own the record: they may retitle it,
 * describe it, move its dates, change its estimate and adjust what it waits
 * on. They may not hand it to somebody else — reassignment stays with whoever
 * planned the work.
 */
async function requireTaskAccess(taskId: string) {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" as const };

  const supabase = await createClient();
  const { data: task } = await supabase
    .from("tasks")
    .select("id,owner_id")
    .eq("id", taskId)
    .maybeSingle();
  if (!task) return { error: "Task not found" as const };

  const admin = await isAdmin();
  if (!admin && task.owner_id !== user.id) {
    return { error: "That task isn't assigned to you." as const };
  }
  return { user, admin };
}

const taskPatchSchema = z.object({
  title: z.string().trim().min(2, "Title is required").optional(),
  description: z.string().trim().nullable().optional(),
  status: statusEnum.optional(),
  priority: priorityEnum.optional(),
  owner_id: optUuid.optional(),
  due_date: optDate.optional(),
  start_date: optDate.optional(),
  estimate_hours: z.coerce.number().min(0).nullable().optional(),
  dependency_id: optUuid.optional(),
});

/**
 * Patch one task from the detail panel. Only the fields sent are written, so
 * changing the status never silently clears a description somebody else just
 * edited in another tab.
 */
export async function patchTask(id: string, input: unknown) {
  const gate = await requireTaskAccess(id);
  if ("error" in gate) return gate;

  const parsed = taskPatchSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const patch = parsed.data;
  if (Object.keys(patch).length === 0) return { success: true };

  // Reassignment is a planning decision, not the assignee's to make.
  if (!gate.admin && "owner_id" in patch) {
    return { error: "Only an admin can reassign a task." };
  }

  // A task that depends on itself would sit blocked forever with no way out.
  if (patch.dependency_id && patch.dependency_id === id) {
    return { error: "A task cannot depend on itself." };
  }

  const supabase = await createClient();
  const { data: before } = await supabase.from("tasks").select("*").eq("id", id).maybeSingle();

  // Walk the chain to make sure the new blocker does not lead back here.
  if (patch.dependency_id) {
    const { data: all } = await supabase.from("tasks").select("id,dependency_id");
    const by = new Map((all ?? []).map((t) => [t.id as string, t.dependency_id as string | null]));
    by.set(id, patch.dependency_id);
    const seen = new Set<string>();
    let cursor: string | null | undefined = id;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      cursor = by.get(cursor);
    }
    if (cursor) return { error: "That would create a circular dependency." };
  }

  const { error } = await supabase.from("tasks").update(patch).eq("id", id);
  if (error) return { error: error.message };

  await logAudit(supabase, gate.user.id, "update", "tasks", id, before, patch);

  if ("owner_id" in patch && patch.owner_id && patch.owner_id !== before?.owner_id) {
    const { data: after } = await supabase
      .from("tasks")
      .select("id,code,title,description,due_date,priority,owner_id")
      .eq("id", id)
      .maybeSingle();
    if (after) await mailTaskAssigned(after, gate.user.id);
  }

  revalidateOs();
  return { success: true };
}

/** Add or clear an extra blocker in the dependency graph (beyond the critical path). */
export async function setTaskEdge(taskId: string, blockerId: string, add: boolean) {
  const gate = await requireTaskAccess(taskId);
  if ("error" in gate) return gate;
  if (taskId === blockerId) return { error: "A task cannot depend on itself." };

  const supabase = await createClient();
  const [{ data: from }, { data: to }] = await Promise.all([
    supabase.from("tasks").select("code,title").eq("id", taskId).maybeSingle(),
    supabase.from("tasks").select("code,title").eq("id", blockerId).maybeSingle(),
  ]);
  if (!from || !to) return { error: "Task not found" };

  if (!add) {
    const { error } = await supabase
      .from("dependencies")
      .delete()
      .eq("from_id", taskId)
      .eq("to_id", blockerId);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("dependencies").insert({
      from_type: `${from.code ?? ""} · ${from.title}`,
      from_id: taskId,
      to_type: `${to.code ?? ""} · ${to.title}`,
      to_id: blockerId,
      status: "open",
    });
    if (error) return { error: error.message };
  }

  await logAudit(supabase, gate.user.id, add ? "create" : "delete", "dependencies", taskId, null, {
    blocker: blockerId,
  });
  revalidateOs();
  return { success: true };
}

/** Post a comment on a task. The author is always the signed-in user. */
export async function addTaskComment(taskId: string, body: string) {
  // Commenting is not editing: anyone who can see the task may say something
  // about it, which is the point of a thread.
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  const gate = { user };
  const text = body.trim();
  if (!text) return { error: "Write something first." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("task_comments")
    .insert({ task_id: taskId, author_id: gate.user.id, body: text });
  if (error) {
    return {
      error: error.message.includes("task_comments")
        ? "Run migration 0015 in Supabase first."
        : error.message,
    };
  }
  revalidateOs();
  return { success: true };
}

/** Remove a comment. RLS already limits this to the author or an admin. */
export async function deleteTaskComment(id: string) {
  // RLS already limits this to the author or an admin.
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  const supabase = await createClient();
  const { error } = await supabase.from("task_comments").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateOs();
  return { success: true };
}

// ─────────────────────── People and access ───────────────────────

/**
 * Replace a person's product grants. Delegates to bos_set_module_access,
 * which re-checks admin in the database and refuses to let an admin edit
 * their own access — so a mistake here cannot lock the OS.
 *
 * The nine keys used to be listed here as well as in os-access.ts, the access
 * page and a CHECK constraint. Since Stage 1 of the Shreex product model plan the
 * catalogue is public.products and the database validates against it, so an
 * unknown key comes back named rather than being silently dropped — which is
 * what the old filter here did.
 */
export async function setModuleAccess(userId: string, sections: string[]) {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;

  const clean = [...new Set(sections)].map((s) => s.trim()).filter(Boolean);

  const supabase = await createClient();
  const { error } = await supabase.rpc("bos_set_module_access", {
    p_user: userId,
    p_sections: clean,
  });
  if (error) {
    if (error.message.includes("CANNOT_EDIT_OWN_ACCESS")) {
      return { error: "You can't change your own access." };
    }
    if (error.message.includes("UNKNOWN_PRODUCT")) {
      const bad = error.message.split("UNKNOWN_PRODUCT:")[1]?.trim();
      return { error: `No such product: ${bad}. Check the product list.` };
    }
    return {
      error: error.message.includes("bos_set_module_access")
        ? "Run migration 0016 in Supabase first."
        : error.message,
    };
  }

  await logAudit(supabase, gate.user.id, "update", "employee_module_access", userId, null, {
    sections: clean,
  });
  revalidateOs();
  return { success: true };
}

const newEmployeeSchema = z.object({
  full_name: z.string().trim().min(2, "Name is required"),
  email: z.string().trim().toLowerCase().email("A valid email is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  title: z.string().trim().optional().nullable(),
  department: z.string().trim().optional().nullable(),
  start_date: optDate,
  // Not an enum: the product list is data now, and bos_set_module_access
  // rejects a key the catalogue does not hold.
  sections: z.array(z.string().trim().min(1)).default([]),
});

/**
 * Onboard an employee here, rather than waiting for them to sign up and then
 * promoting them. Creates the account, marks them an employee, records their
 * title and department, and grants their sections in one step.
 *
 * If the email already has an account — someone who registered as a member
 * first — that account is promoted instead of failing, because the alternative
 * is an admin stuck with an error and no way forward.
 */
export async function createEmployee(input: unknown) {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;

  const parsed = newEmployeeSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { full_name, email, password, title, department, start_date, sections } = parsed.data;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return { error: "Creating accounts isn't configured on the server (missing SUPABASE_SERVICE_ROLE_KEY)." };
  }

  const { createClient: createAdminClient } = await import("@supabase/supabase-js");
  const admin = createAdminClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const supabase = await createClient();
  let userId: string | null = null;
  let promoted = false;

  // Already registered? Promote rather than fail.
  const { data: existing } = await supabase
    .from("users")
    .select("id,primary_role")
    .eq("email", email)
    .maybeSingle();

  if (existing) {
    if (existing.primary_role === "admin") {
      return { error: "That email belongs to an admin, who already has every section." };
    }
    userId = existing.id as string;
    promoted = true;
  } else {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name },
    });
    if (createErr || !created?.user) {
      return { error: createErr?.message ?? "Could not create the account." };
    }
    userId = created.user.id;
  }

  // handle_new_user() writes the public.users row; make them an employee.
  const { error: roleErr } = await supabase
    .from("users")
    .update({ primary_role: "employee", full_name })
    .eq("id", userId);
  if (roleErr) return { error: roleErr.message };

  // Title and department live on employee_profiles, which People & Hiring reads.
  await supabase.from("employee_profiles").upsert(
    {
      user_id: userId,
      title: title || null,
      department: department || null,
      start_date: start_date || null,
      status: "active",
    },
    // Scoped to the tenant since 0035: one profile per person per business,
    // not one per person.
    { onConflict: "tenant_id,user_id" },
  );

  if (sections.length > 0) {
    const { error: accessErr } = await supabase.rpc("bos_set_module_access", {
      p_user: userId,
      p_sections: sections,
    });
    if (accessErr) {
      return {
        error: accessErr.message.includes("bos_set_module_access")
          ? "Employee created, but run migration 0016 before assigning sections."
          : accessErr.message,
      };
    }
  }

  await logAudit(supabase, gate.user.id, "create", "users", userId, null, {
    full_name,
    email,
    primary_role: "employee",
    sections,
    promoted,
  });

  // No password in here — the admin who set it hands it over directly, and a
  // credential in a mailbox outlives its usefulness immediately.
  try {
    await sendEmployeeWelcome({
      to: email,
      name: full_name.split(" ")[0] || full_name,
      title: title || null,
      sections: await (async () => {
        const labels = await productLabels();
        return sections.map((k) => labels[k] ?? k);
      })(),
    });
  } catch {
    // An account that exists but whose welcome bounced is still an account.
  }

  revalidateOs();
  return { success: true, promoted };
}

/** Take someone off the team: revoke every section and mark the profile ended. */
export async function offboardEmployee(userId: string) {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;
  if (userId === gate.user.id) return { error: "You can't offboard yourself." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("bos_set_module_access", {
    p_user: userId,
    p_sections: [],
  });
  if (error && !error.message.includes("bos_set_module_access")) {
    return { error: error.message };
  }

  await supabase.from("employee_profiles").update({ status: "ended" }).eq("user_id", userId);
  await supabase.from("users").update({ primary_role: "community_member" }).eq("id", userId);

  await logAudit(supabase, gate.user.id, "update", "users", userId, null, { offboarded: true });
  revalidateOs();
  return { success: true };
}

// ─────────────────────── An employee's own work ───────────────────────

/**
 * Move one of your own tasks between stages.
 *
 * setTaskStatus() requires admin, which left an employee looking at their
 * tasks unable to touch them. The RLS policy "owner update own task" already
 * allows this; only the action was in the way. The owner check is repeated
 * here so a wrong id fails with a clear message rather than silently
 * updating nothing.
 */
export async function setMyTaskStatus(taskId: string, status: z.infer<typeof statusEnum>) {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  if (!statusEnum.safeParse(status).success) return { error: "Unknown status" };

  const supabase = await createClient();
  const { data: task } = await supabase
    .from("tasks")
    .select("id,owner_id,status")
    .eq("id", taskId)
    .maybeSingle();

  if (!task) return { error: "Task not found" };
  if (task.owner_id !== user.id && !(await isAdmin())) {
    return { error: "That task isn't assigned to you." };
  }

  const { error } = await supabase.from("tasks").update({ status }).eq("id", taskId);
  if (error) return { error: error.message };

  await logAudit(supabase, user.id, "update", "tasks", taskId, { status: task.status }, { status });
  revalidateOs();
  revalidatePath("/workspace");
  return { success: true };
}

// ───────────────────────── Task approval ─────────────────────────
//
// Completing a task is not the assignee's call. They submit it and an admin
// approves; approving is what completes it. Migration 0020 enforces all of
// this in a trigger, so these actions mostly exist to carry its message back
// to the person rather than to do the checking themselves.

/** Put a finished task up for approval. Needs an assignee and a comment. */
export async function submitTaskForApproval(taskId: string) {
  const gate = await requireTaskAccess(taskId);
  if ("error" in gate) return gate;

  const supabase = await createClient();
  const { error } = await supabase
    .from("tasks")
    .update({ approval_state: "pending", decision_note: null })
    .eq("id", taskId);
  if (error) return { error: error.message };

  await logAudit(supabase, gate.user.id, "update", "tasks", taskId, null, {
    approval_state: "pending",
  });

  const { data: submitted } = await supabase
    .from("tasks")
    .select("id,code,title,owner_id")
    .eq("id", taskId)
    .maybeSingle();
  if (submitted) await mailTaskSubmitted(submitted, gate.user.id);

  revalidateOs();
  return { success: true };
}

/**
 * Approve the work, which completes it, or send it back with a reason.
 *
 * Approving writes the status in the same update: the trigger reads the new
 * approval_state, so one statement satisfies the gate where two would have to
 * be ordered carefully.
 */
export async function decideTaskApproval(
  taskId: string,
  decision: "approved" | "rejected",
  note?: string,
) {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;
  if (decision !== "approved" && decision !== "rejected") {
    return { error: "Unknown decision" };
  }
  const trimmed = (note ?? "").trim();
  if (decision === "rejected" && !trimmed) {
    return { error: "Say why it is going back, so the work can be fixed." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("tasks")
    .update({
      approval_state: decision,
      decision_note: trimmed || null,
      ...(decision === "approved" ? { status: "completed" } : {}),
    })
    .eq("id", taskId);
  if (error) return { error: error.message };

  await logAudit(supabase, gate.user.id, "update", "tasks", taskId, null, {
    approval_state: decision,
    decision_note: trimmed || null,
  });

  const { data: decided } = await supabase
    .from("tasks")
    .select("id,code,title,owner_id")
    .eq("id", taskId)
    .maybeSingle();
  if (decided) {
    await mailTaskDecision(decided, decision === "approved", trimmed || null, gate.user.id);
  }

  revalidateOs();
  revalidatePath("/shreex/approvals");
  return { success: true };
}

// ─────────────────────────── Products ───────────────────────────

/**
 * Turn a product on or off for the whole install.
 *
 * Off means off for everyone, admins included — bos_can_access refuses a
 * disabled product whoever asks. That is deliberate: a toggle an admin can
 * see through is not a toggle. It is also why this lives behind the access
 * page, which is guarded by isAdmin directly rather than by requireSection,
 * so disabling a product can never lock an admin out of re-enabling it.
 *
 * Grants are left alone. Re-enabling restores exactly who had it before,
 * which matters because the alternative — cascading a delete through
 * employee_module_access — makes a reversible toggle quietly destructive.
 */
export async function setProductEnabled(key: string, enabled: boolean) {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;

  const supabase = await createClient();
  const { data: before } = await supabase
    .from("products")
    .select("key,is_enabled")
    .eq("key", key)
    .maybeSingle();
  if (!before) return { error: `No such product: ${key}` };

  const { error } = await supabase
    .from("products")
    .update({ is_enabled: enabled })
    .eq("key", key);
  if (error) {
    return {
      error: error.message.includes("products")
        ? "Run migration 0033 in Supabase first."
        : error.message,
    };
  }

  await logAudit(supabase, gate.user.id, "update", "products", key, before, {
    key,
    is_enabled: enabled,
  });
  revalidatePath(OS, "layout");
  return { success: true };
}

const productSchema = z.object({
  name: z.string().trim().min(2, "A name is required"),
  description: z.string().trim().max(400).optional().nullable(),
});

/**
 * Rename a product, or change the line of description under it. The nav reads
 * products.name, so renaming Govern to Compliance renames it everywhere —
 * which is the whole point of the catalogue being data.
 *
 * The key is never editable. It is referenced by employee_module_access and
 * by requireSection in the page code, so changing it would orphan both.
 */
export async function updateProduct(key: string, input: unknown) {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;

  const parsed = productSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { data: before } = await supabase
    .from("products")
    .select("key,name,description")
    .eq("key", key)
    .maybeSingle();
  if (!before) return { error: `No such product: ${key}` };

  const { error } = await supabase
    .from("products")
    .update({
      name: parsed.data.name,
      description: parsed.data.description || null,
    })
    .eq("key", key);
  if (error) return { error: error.message };

  await logAudit(supabase, gate.user.id, "update", "products", key, before, parsed.data);
  revalidatePath(OS, "layout");
  return { success: true };
}

// ─────────────────────────── Tenancy ───────────────────────────

/**
 * Switch the signed-in person into one of their businesses.
 *
 * The tenant is named by the client and decided by the database:
 * bos_switch_tenant refuses anything the caller is not an active member of,
 * which is what makes a server-side column safe to trust where a
 * client-supplied value would not be.
 *
 * revalidatePath with "layout" rather than a page, because switching changes
 * what every query in the OS returns — the nav, the counts, all of it.
 */
export async function switchTenant(tenantId: string) {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("bos_switch_tenant", { p_tenant: tenantId });
  if (error) {
    if (error.message.includes("NOT_A_MEMBER")) {
      return { error: "You don't belong to that business." };
    }
    return {
      error: error.message.includes("bos_switch_tenant")
        ? "Run migration 0047 in Supabase first."
        : error.message,
    };
  }

  revalidatePath(OS, "layout");
  revalidatePath("/", "layout");
  return { success: true };
}

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("A valid email is required"),
  role: z.enum(["admin", "employee", "event_host", "community_member"]).default("employee"),
  sections: z.array(z.string().trim().min(1)).default([]),
});

/**
 * Invite someone to the business the admin is acting in.
 *
 * createEmployee stays: it makes an account with a password and works for
 * somebody who has none. What it cannot do is add a person who ALREADY has an
 * account — a member who registered on the public site, or somebody who works
 * at another business on the platform. This is that path, and it becomes the
 * only sensible one once a person can belong to several businesses.
 *
 * Returns the token rather than emailing it, because the caller decides how
 * the invitation travels. Re-inviting the same address issues a new token, so
 * a link that leaked can be revoked by issuing another.
 */
export async function inviteToTenant(input: unknown) {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;

  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bos_invite_to_tenant", {
    p_email: parsed.data.email,
    p_role: parsed.data.role,
    p_sections: parsed.data.sections,
  });

  if (error) {
    const m = error.message;
    if (m.includes("ALREADY_A_MEMBER")) return { error: "They're already in this business." };
    if (m.includes("UNKNOWN_PRODUCT")) {
      return { error: `No such product: ${m.split("UNKNOWN_PRODUCT:")[1]?.trim()}` };
    }
    if (m.includes("BAD_EMAIL")) return { error: "That doesn't look like an email address." };
    if (m.includes("BAD_ROLE")) return { error: "That isn't a role." };
    if (m.includes("bos_invite_to_tenant")) return { error: "Run migration 0047 in Supabase first." };
    return { error: m };
  }

  await logAudit(supabase, gate.user.id, "insert", "tenant_invitations", null, null, {
    email: parsed.data.email,
    role: parsed.data.role,
    sections: parsed.data.sections,
  });
  revalidatePath(`${OS}/team/access`);
  return { success: true, token: data as string };
}

/**
 * Create a business.
 *
 * Thin on purpose. bos_create_tenant writes the tenant, the creator's admin
 * membership and the product list in one statement, because a tenant with no
 * admin is unreachable and a tenant with no products is an empty shell. None
 * of that belongs in a server action where a failed second write would leave
 * the first one standing.
 *
 * The slug is derived by the database rather than sent, so there is exactly
 * one implementation of what a slug may contain.
 */
export async function createOrganisation(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim();
  if (name.length < 2) return { error: "Give the business a name." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bos_create_tenant", {
    p_name: name,
    p_slug: slug || null,
  });

  if (error) {
    const m = error.message;
    if (m.includes("bos_create_tenant")) return { error: "Run migration 0050 in Supabase first." };
    // 0052 replaced NOT_PLATFORM_OWNER and NO_DEFAULT_TENANT with one reason:
    // the authority is a row in platform_admins, not a membership anywhere.
    if (m.includes("NOT_SUPER_ADMIN") || m.includes("NOT_PLATFORM_OWNER")) {
      return { error: "Only a platform administrator can create a business." };
    }
    if (m.includes("SLUG_TAKEN")) return { error: `The address "${m.split("SLUG_TAKEN:")[1]?.trim() ?? slug}" is already taken.` };
    if (m.includes("BAD_SLUG")) return { error: "That name has no letters or numbers to build an address from." };
    if (m.includes("BAD_NAME")) return { error: "Give the business a name of at least two characters." };
    return { error: m };
  }

  await logAudit(supabase, user.id, "create", "tenants", String(data), null, { name, slug: slug || null });
  revalidatePath(OS, "layout");
  return { success: true, id: data as string };
}

/** Rename a business you administer. The slug does not follow — it is an address. */
export async function renameOrganisation(tenantId: string, name: string) {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  if (name.trim().length < 2) return { error: "Give the business a name of at least two characters." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("bos_rename_tenant", { p_tenant: tenantId, p_name: name.trim() });
  if (error) {
    if (error.message.includes("bos_rename_tenant")) return { error: "Run migration 0050 in Supabase first." };
    if (error.message.includes("FORBIDDEN")) return { error: "You are not an admin of that business." };
    return { error: error.message };
  }

  await logAudit(supabase, user.id, "update", "tenants", tenantId, null, { name: name.trim() });
  revalidatePath(OS, "layout");
  return { success: true };
}

/**
 * Suspend, archive or reactivate a business you administer.
 *
 * The database refuses this for the default business, which bos_request_tenant
 * falls back to: suspending it would hide it from bos_my_tenants and leave
 * every account with no active tenant pointing at something the switcher
 * will not offer back.
 */
export async function setOrganisationStatus(tenantId: string, status: string) {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("bos_set_tenant_status", { p_tenant: tenantId, p_status: status });
  if (error) {
    const m = error.message;
    if (m.includes("bos_set_tenant_status")) return { error: "Run migration 0050 in Supabase first." };
    if (m.includes("CANNOT_SUSPEND_DEFAULT")) return { error: "The main business cannot be suspended — everything falls back to it." };
    if (m.includes("FORBIDDEN")) return { error: "You are not an admin of that business." };
    if (m.includes("BAD_STATUS")) return { error: `"${status}" is not a status.` };
    return { error: m };
  }

  await logAudit(supabase, user.id, "update", "tenants", tenantId, null, { status });
  revalidatePath(OS, "layout");
  revalidatePath("/", "layout");
  return { success: true };
}

/**
 * Switch a product on or off FOR THE BUSINESS the admin is acting in.
 *
 * Distinct from setProductEnabled, which edits the platform catalogue and
 * since 0051 is a platform owner act — it was writable by any tenant admin,
 * so one business could switch a product off for every business.
 */
export async function setTenantProduct(key: string, enabled: boolean) {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;

  const supabase = await createClient();
  const { error } = await supabase.rpc("bos_set_tenant_product", {
    p_key: key,
    p_enabled: enabled,
  });
  if (error) {
    const m = error.message;
    if (m.includes("bos_set_tenant_product")) return { error: "Run migration 0051 in Supabase first." };
    if (m.includes("UNKNOWN_PRODUCT")) return { error: `No such product: ${key}` };
    if (m.includes("FORBIDDEN")) return { error: "Only an admin of this business can do that." };
    return { error: m };
  }

  await logAudit(supabase, gate.user.id, "update", "tenant_products", key, null, { is_enabled: enabled });
  // "layout" because it changes the nav, not just this page.
  revalidatePath(OS, "layout");
  return { success: true };
}

/** Change what somebody is in this business. Refuses to demote the last admin. */
export async function setMemberRole(userId: string, role: string) {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;

  const supabase = await createClient();
  const { error } = await supabase.rpc("bos_set_member_role", { p_user: userId, p_role: role });
  if (error) {
    const m = error.message;
    if (m.includes("bos_set_member_role")) return { error: "Run migration 0051 in Supabase first." };
    if (m.includes("LAST_ADMIN")) return { error: "They're the last admin. Appoint another one first — only an admin can." };
    if (m.includes("NOT_A_MEMBER")) return { error: "They're not in this business." };
    if (m.includes("BAD_ROLE")) return { error: `"${role}" isn't a role.` };
    return { error: m };
  }

  await logAudit(supabase, gate.user.id, "update", "tenant_members", userId, null, { role });
  revalidatePath(OS, "layout");
  return { success: true };
}

/**
 * Remove somebody from this business.
 *
 * The membership is ended rather than deleted, so every row they wrote stays
 * readable. Their grants in THIS business go; grants in another business are
 * not this business to revoke.
 */
export async function removeMember(userId: string) {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;

  const supabase = await createClient();
  const { error } = await supabase.rpc("bos_remove_member", { p_user: userId });
  if (error) {
    const m = error.message;
    if (m.includes("bos_remove_member")) return { error: "Run migration 0051 in Supabase first." };
    if (m.includes("LAST_ADMIN")) return { error: "They're the last admin. Appoint another one first." };
    if (m.includes("NOT_A_MEMBER")) return { error: "They're not in this business." };
    return { error: m };
  }

  await logAudit(supabase, gate.user.id, "delete", "tenant_members", userId, null, null);
  revalidatePath(OS, "layout");
  return { success: true };
}

/**
 * Withdraw a pending invitation.
 *
 * A plain delete rather than an RPC: the "tenant admin manages invitations"
 * policy from 0047 already scopes it to the caller business, and unlike a
 * membership there is no history worth keeping — nobody has acted as this
 * invitation yet.
 */
export async function revokeInvitation(id: string) {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;

  const supabase = await createClient();
  const { error } = await supabase.from("tenant_invitations").delete().eq("id", id);
  if (error) return { error: error.message };

  await logAudit(supabase, gate.user.id, "delete", "tenant_invitations", id, null, null);
  revalidatePath(`${OS}/team/access`);
  return { success: true };
}

/**
 * Accept an invitation and join the business it names.
 *
 * Not admin-gated: the caller is by definition not in the business yet. The
 * database decides — bos_accept_invitation checks the token against the
 * signed-in address, so holding the link is not enough if it was sent to
 * somebody else.
 */
export async function acceptInvitation(token: string) {
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in first." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bos_accept_invitation", { p_token: token });
  if (error) {
    const m = error.message;
    if (m.includes("bos_accept_invitation")) return { error: "Run migration 0047 in Supabase first." };
    // The codes 0047 actually raises: NO_SUCH_INVITATION, ALREADY_ACCEPTED,
    // INVITATION_EXPIRED, WRONG_ACCOUNT, NOT_SIGNED_IN.
    if (m.includes("NO_SUCH_INVITATION")) return { error: "That invitation link is not valid." };
    if (m.includes("INVITATION_EXPIRED")) return { error: "That invitation has expired. Ask for another." };
    if (m.includes("ALREADY_ACCEPTED")) return { error: "That invitation has already been used." };
    if (m.includes("WRONG_ACCOUNT")) {
      return { error: "That invitation was sent to a different address. Sign in as that address and open the link again." };
    }
    if (m.includes("NOT_SIGNED_IN")) return { error: "Sign in first." };
    return { error: m };
  }

  revalidatePath(OS, "layout");
  revalidatePath("/", "layout");
  return { success: true, result: data };
}

/**
 * Appoint a platform administrator, by address.
 *
 * Before 0052 the only way to appoint one was the SQL editor, because the
 * authority was "admin of the tenant flagged default" and there was nothing to
 * grant. The address is resolved inside the database: a page should not have
 * to know user ids, and bos_grant_platform_admin is the only thing that looks
 * an account up across the platform.
 */
export async function grantPlatformAdmin(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const email = String(formData.get("email") ?? "").trim();
  const role = String(formData.get("role") ?? "super_admin");
  const days = Number(formData.get("days") ?? 0);
  // Support access is time-boxed by the database, so send an end date with it
  // rather than letting the call fail on SUPPORT_NEEDS_EXPIRY.
  const expires =
    role === "support"
      ? new Date(Date.now() + (days > 0 ? days : 7) * 86_400_000).toISOString()
      : null;

  const supabase = await createClient();
  const { error } = await supabase.rpc("bos_grant_platform_admin", {
    p_email: email,
    p_role: role,
    p_expires: expires,
  });

  if (error) {
    const m = error.message;
    if (m.includes("bos_grant_platform_admin")) return { error: "Run migration 0052 in Supabase first." };
    if (m.includes("NOT_SUPER_ADMIN")) return { error: "Only a platform administrator can appoint one." };
    if (m.includes("NO_SUCH_ACCOUNT")) return { error: `No account with the address ${email}. They have to sign up first.` };
    if (m.includes("BAD_EMAIL")) return { error: "That doesn't look like an email address." };
    if (m.includes("SUPPORT_NEEDS_EXPIRY")) return { error: "Support access has to have an end date." };
    if (m.includes("EXPIRY_IN_THE_PAST")) return { error: "That end date has already passed." };
    return { error: m };
  }

  await logAudit(supabase, user.id, "insert", "platform_admins", null, null, { email, role, expires });
  revalidatePath(OS, "layout");
  return { success: true };
}

/** Remove a platform administrator. The database refuses the last super admin. */
export async function revokePlatformAdmin(userId: string) {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("bos_revoke_platform_admin", { p_user: userId });
  if (error) {
    const m = error.message;
    if (m.includes("bos_revoke_platform_admin")) return { error: "Run migration 0052 in Supabase first." };
    if (m.includes("NOT_SUPER_ADMIN")) return { error: "Only a platform administrator can do that." };
    if (m.includes("LAST_SUPER_ADMIN")) {
      return { error: "They're the last platform administrator. Appoint another one first — nobody else can." };
    }
    return { error: m };
  }

  await logAudit(supabase, user.id, "delete", "platform_admins", userId, null, null);
  revalidatePath(OS, "layout");
  return { success: true };
}

/**
 * Appoint somebody to a business from the platform console, by address.
 *
 * A business created by a super admin has only the super admin as its admin,
 * which is useless — the point of creating one is to hand it over, and it
 * cannot be handed over from inside itself. So this is a platform act, super
 * admin only, logged in the business that gained the member.
 */
export async function assignTenantAdmin(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const tenantId = String(formData.get("tenantId") ?? "");
  const email = String(formData.get("email") ?? "").trim();
  const role = String(formData.get("role") ?? "admin");

  const supabase = await createClient();
  const { error } = await supabase.rpc("bos_assign_tenant_admin", {
    p_tenant: tenantId,
    p_email: email,
    p_role: role,
  });

  if (error) {
    const m = error.message;
    if (m.includes("bos_assign_tenant_admin")) return { error: "Run migration 0053 in Supabase first." };
    if (m.includes("NOT_SUPER_ADMIN")) return { error: "Only a platform administrator can do that." };
    if (m.includes("NO_SUCH_ACCOUNT")) {
      return { error: `No account with the address ${email}. They have to sign up first — or invite them from inside the business instead.` };
    }
    if (m.includes("NO_SUCH_TENANT")) return { error: "That business no longer exists." };
    if (m.includes("BAD_EMAIL")) return { error: "That doesn't look like an email address." };
    if (m.includes("BAD_ROLE")) return { error: `"${role}" isn't a role.` };
    return { error: m };
  }

  revalidatePath("/shreex/platform");
  revalidatePath(OS, "layout");
  return { success: true };
}

/** Remove somebody from a named business, from the platform console. */
export async function unassignTenantMember(tenantId: string, userId: string) {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("bos_unassign_tenant_member", {
    p_tenant: tenantId,
    p_user: userId,
  });
  if (error) {
    const m = error.message;
    if (m.includes("bos_unassign_tenant_member")) return { error: "Run migration 0053 in Supabase first." };
    if (m.includes("NOT_SUPER_ADMIN")) return { error: "Only a platform administrator can do that." };
    if (m.includes("LAST_ADMIN")) {
      return { error: "They're the last admin of that business. Appoint another one first — the business cannot do it itself." };
    }
    if (m.includes("NOT_A_MEMBER")) return { error: "They're not in that business." };
    return { error: m };
  }

  revalidatePath("/shreex/platform");
  revalidatePath(OS, "layout");
  return { success: true };
}
