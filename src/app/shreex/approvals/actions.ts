"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { sendApprovalDecision } from "@/lib/email";
import { lookupUser, firstNameOf } from "@/lib/mail-recipients";

/** Approve / reject an approval request via the decide_approval RPC (0009),
 * which stamps the decision and notifies the requester. Audit-logged. */
export async function decideApproval(id: string, decision: "approved" | "rejected" | "pending", comments?: string) {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  if (!(await isAdmin())) return { error: "Not authorised" };

  const supabase = await createClient();

  // A task approval has two sides: the request row, and the task itself.
  // Deciding here has to move both, or the inbox empties while the task sits
  // pending forever.
  const { data: req } = await supabase
    .from("approvals")
    .select("related_type,related_id,request_type,request_title,requester_id")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.rpc("decide_approval", {
    p_id: id,
    p_decision: decision,
    p_comments: comments ?? null,
  });
  if (error) return { error: error.message };

  if (req?.related_type === "task" && req.related_id && decision !== "pending") {
    const { error: taskErr } = await supabase
      .from("tasks")
      .update({
        approval_state: decision,
        decision_note: comments ?? null,
        ...(decision === "approved" ? { status: "completed" } : {}),
      })
      .eq("id", req.related_id);
    // The trigger from 0020 refuses an approval the task is not ready for —
    // say so rather than leaving the two records disagreeing.
    if (taskErr) return { error: taskErr.message };
    revalidatePath("/shreex/tasks");
    revalidatePath("/shreex/roadmap");
  }

  // A task approval already emails through decideTaskApproval; anything else
  // in the queue had no way of reaching the person who raised it.
  if (req && req.related_type !== "task" && req.requester_id && decision !== "pending"
      && req.requester_id !== user.id) {
    try {
      const person = await lookupUser(req.requester_id);
      if (person?.email) {
        await sendApprovalDecision({
          to: person.email,
          name: firstNameOf(person),
          requestType: req.request_type ?? "Approval",
          requestTitle: req.request_title ?? "Your request",
          approved: decision === "approved",
          comments: comments ?? null,
        });
      }
    } catch {
      // The decision stands whether or not the email got through.
    }
  }

  await supabase.from("audit_log").insert({
    user_id: user.id,
    action: "decide",
    entity: "approvals",
    entity_id: id,
    after: { decision, comments: comments ?? null },
  });

  revalidatePath("/shreex/approvals");
  revalidatePath("/shreex");
  return { success: true };
}
