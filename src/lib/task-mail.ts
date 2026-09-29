import "server-only";
import { createClient } from "@supabase/supabase-js";
import {
  sendTaskAssigned,
  sendTaskDecision,
  sendTaskSubmitted,
  sendTaskReviewed,
} from "@/lib/email";

/**
 * Email for the moments a task changes hands.
 *
 * Two reasons this does not live in the server actions themselves. First,
 * addresses: "read own profile" means a signed-in caller cannot read anybody
 * else's email, so recipients are resolved with the service role. Second,
 * failure: an email must never take a write down with it, so everything here
 * swallows its own errors — `send` already records them in email_failures.
 *
 * Nothing is sent where SMTP is unconfigured; `send` logs and returns.
 */

type Row = { id: string; email: string | null; full_name: string | null };

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function people(ids: (string | null | undefined)[]): Promise<Map<string, Row>> {
  const wanted = [...new Set(ids.filter(Boolean))] as string[];
  const db = admin();
  if (!db || wanted.length === 0) return new Map();
  const { data } = await db.from("users").select("id,email,full_name").in("id", wanted);
  return new Map(((data as Row[]) ?? []).map((r) => [r.id, r]));
}

const firstName = (r?: Row) => (r?.full_name || r?.email || "there").split(" ")[0];

type TaskLike = {
  id: string;
  code: string | null;
  title: string;
  description?: string | null;
  due_date?: string | null;
  priority?: string | null;
  owner_id: string | null;
};

const when = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : null;

/** Somebody has been given a task. */
export async function mailTaskAssigned(task: TaskLike, byId: string | null) {
  try {
    if (!task.owner_id || task.owner_id === byId) return;
    const who = await people([task.owner_id, byId]);
    const to = who.get(task.owner_id);
    if (!to?.email) return;
    await sendTaskAssigned({
      to: to.email,
      name: firstName(to),
      code: task.code,
      title: task.title,
      description: task.description,
      dueDate: when(task.due_date),
      priority: task.priority,
      assignedBy: byId ? who.get(byId)?.full_name ?? null : null,
      taskId: task.id,
    });
  } catch {
    // Never let the notification break the assignment.
  }
}

/** An admin approved the work, or sent it back. */
export async function mailTaskDecision(
  task: TaskLike,
  approved: boolean,
  note: string | null,
  byId: string | null,
) {
  try {
    if (!task.owner_id || task.owner_id === byId) return;
    const who = await people([task.owner_id, byId]);
    const to = who.get(task.owner_id);
    if (!to?.email) return;
    await sendTaskDecision({
      to: to.email,
      name: firstName(to),
      code: task.code,
      title: task.title,
      approved,
      note,
      decidedBy: byId ? who.get(byId)?.full_name ?? null : null,
      taskId: task.id,
    });
  } catch {
    /* as above */
  }
}

/** Work is waiting on an admin. Every admin is told, since any of them can act. */
export async function mailTaskSubmitted(task: TaskLike, byId: string | null) {
  try {
    const db = admin();
    if (!db) return;
    const { data } = await db
      .from("users")
      .select("id,email,full_name")
      .eq("primary_role", "admin");
    const admins = ((data as Row[]) ?? []).filter((a) => a.email && a.id !== byId);
    if (admins.length === 0) return;
    const submitter = byId ? (await people([byId])).get(byId)?.full_name ?? null : null;
    await Promise.all(
      admins.map((a) =>
        sendTaskSubmitted({
          to: a.email!,
          name: firstName(a),
          code: task.code,
          title: task.title,
          submittedBy: submitter,
          taskId: task.id,
        }),
      ),
    );
  } catch {
    /* as above */
  }
}

/** The review has been written. */
export async function mailTaskReviewed(opts: {
  taskId: string;
  outcome: "met" | "partial" | "missed";
  quality: number | null;
  learning: string | null;
  byId: string | null;
}) {
  try {
    const db = admin();
    if (!db) return;
    const { data: task } = await db
      .from("tasks")
      .select("id,code,title,owner_id")
      .eq("id", opts.taskId)
      .maybeSingle();
    const t = task as TaskLike | null;
    if (!t?.owner_id || t.owner_id === opts.byId) return;
    const who = await people([t.owner_id, opts.byId]);
    const to = who.get(t.owner_id);
    if (!to?.email) return;
    await sendTaskReviewed({
      to: to.email,
      name: firstName(to),
      code: t.code,
      title: t.title,
      outcome: opts.outcome,
      quality: opts.quality,
      learning: opts.learning,
      reviewedBy: opts.byId ? who.get(opts.byId)?.full_name ?? null : null,
    });
  } catch {
    /* as above */
  }
}
