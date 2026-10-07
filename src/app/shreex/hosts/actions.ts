"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { sendHostMessage } from "@/lib/email";
import { lookupUser, firstNameOf } from "@/lib/mail-recipients";

const STAGES = ["new", "qualifying", "proposed", "scheduled", "running", "done", "declined"] as const;

async function requireEvents() {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" as const };
  const supabase = await createClient();
  const { data } = await supabase.rpc("bos_can_access", { p_section: "events" });
  if (data !== true && !(await isAdmin())) return { error: "Not authorised" as const };
  return { user, supabase };
}

/** Move a request along the pipeline. The move itself is logged to the thread. */
export async function setHostStage(id: string, stage: string) {
  const gate = await requireEvents();
  if ("error" in gate) return gate;
  if (!(STAGES as readonly string[]).includes(stage)) return { error: "Unknown stage" };

  const { supabase, user } = gate;
  const { data: before } = await supabase
    .from("host_submissions")
    .select("stage")
    .eq("id", id)
    .maybeSingle();
  if ((before as { stage?: string } | null)?.stage === stage) return { success: true };

  const { error } = await supabase.from("host_submissions").update({ stage }).eq("id", id);
  if (error) return { error: error.message };

  // A stage change with no record of who moved it or when is how a pipeline
  // becomes untrustworthy.
  await supabase.from("host_messages").insert({
    submission_id: id,
    author_id: user.id,
    kind: "stage",
    body: `Moved from ${(before as { stage?: string } | null)?.stage ?? "new"} to ${stage}.`,
  });

  revalidatePath("/shreex/hosts");
  return { success: true };
}

const detailSchema = z.object({
  owner_id: z.string().uuid().or(z.literal("")).transform((v) => v || null).optional().nullable(),
  event_id: z.string().uuid().or(z.literal("")).transform((v) => v || null).optional().nullable(),
  next_step: z.string().trim().optional().nullable(),
  next_step_on: z.string().optional().nullable(),
});

/** Owner, the event it became, and what happens next. */
export async function updateHostRequest(id: string, input: unknown) {
  const gate = await requireEvents();
  if ("error" in gate) return gate;
  const parsed = detailSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const { error } = await gate.supabase
    .from("host_submissions")
    .update({ ...parsed.data, next_step_on: parsed.data.next_step_on || null })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/shreex/hosts");
  return { success: true };
}

/** A note in the thread. Not sent anywhere. */
export async function addHostNote(id: string, body: string) {
  const gate = await requireEvents();
  if ("error" in gate) return gate;
  const text = (body ?? "").trim();
  if (!text) return { error: "Nothing to save" };

  const { error } = await gate.supabase.from("host_messages").insert({
    submission_id: id,
    author_id: gate.user.id,
    kind: "note",
    body: text,
  });
  if (error) return { error: error.message };
  revalidatePath("/shreex/hosts");
  return { success: true };
}

const emailSchema = z.object({
  to: z.string().email("That is not an email address"),
  subject: z.string().trim().min(1, "A subject is required"),
  body: z.string().trim().min(1, "There is no message"),
});

/**
 * Send the email, and keep it.
 *
 * The thread is the point. An email sent from somebody's own client is
 * invisible to everyone else, which is the problem this whole section exists
 * to fix — so the record is written whether or not delivery succeeds, with
 * the failure recorded separately in email_failures.
 */
export async function sendHostEmail(id: string, input: unknown) {
  const gate = await requireEvents();
  if ("error" in gate) return gate;

  const parsed = emailSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { to, subject, body } = parsed.data;

  const sender = await lookupUser(gate.user.id);

  await sendHostMessage({
    to,
    subject,
    body,
    senderName: sender?.full_name ?? null,
  }).catch(() => {
    // Recorded in email_failures by send(); the thread entry below still
    // stands, because what was written is worth keeping either way.
  });

  const { error } = await gate.supabase.from("host_messages").insert({
    submission_id: id,
    author_id: gate.user.id,
    kind: "email",
    subject,
    body,
    to_email: to,
  });
  if (error) return { error: error.message };

  revalidatePath("/shreex/hosts");
  return { success: true, sentBy: firstNameOf(sender) };
}
