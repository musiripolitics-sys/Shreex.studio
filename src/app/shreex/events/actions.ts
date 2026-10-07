"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";

const schema = z.object({
  event_id: z.string().uuid(),
  event_type: z.string().trim().optional().nullable(),
  is_client_event: z.coerce.boolean().default(false),
  client_name: z.string().trim().optional().nullable(),
  owner_id: z.string().uuid().or(z.literal("")).transform((v) => v || null).optional().nullable(),
  budget: z.coerce.number().int().min(0).default(0),
  actual_cost: z.coerce.number().int().min(0).default(0),
  revenue_target: z.coerce.number().int().min(0).default(0),
  marketing_campaign_id: z.string().uuid().or(z.literal("")).transform((v) => v || null).optional().nullable(),
  partners: z.string().trim().optional().nullable(),
  feedback: z.string().trim().optional().nullable(),
});

/** Upsert the Shreex financial/ops row for an existing event (1:1 event_ops). */
export async function saveEventOps(input: unknown) {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  if (!(await isAdmin())) return { error: "Not authorised" };

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("event_ops")
    .upsert(parsed.data, { onConflict: "event_id" })
    .select()
    .maybeSingle();
  if (error) return { error: error.message };

  await supabase.from("audit_log").insert({
    user_id: user.id, action: "upsert", entity: "event_ops",
    entity_id: data?.id ?? null, after: parsed.data,
  });

  revalidatePath("/shreex/events");
  revalidatePath("/shreex");
  return { success: true };
}

// ─────────────────────── The event itself, not the overlay ───────────────────────
//
// saveEventOps above writes the OS-only columns beside an event. This writes
// the event the website renders: change it here and the public page changes.

const eventSchema = z.object({
  title: z.string().trim().min(1, "A title is required"),
  category: z.enum(["Meetup", "Workshop", "Webinar", "Hackathon", "Conference", "Networking", "Product Launch"]),
  date: z.string().min(1, "A date is required"),
  end_date: z.string().optional().nullable(),
  time: z.string().trim().optional().nullable(),
  city: z.string().trim().min(1, "A city is required"),
  venue: z.string().trim().optional().nullable(),
  address: z.string().trim().optional().nullable(),
  price_type: z.enum(["Free", "Paid"]),
  price_amount: z.coerce.number().int().min(0).default(0),
  price_label: z.string().trim().optional().nullable(),
  capacity: z.coerce.number().int().min(0).default(0),
  blurb: z.string().trim().optional().nullable(),
  about: z.string().trim().optional().nullable(),
  image_url: z.string().trim().optional().nullable(),
  status: z.enum(["draft", "pending_review", "approved", "published", "cancelled", "completed"]),
  host_name: z.string().trim().optional().nullable(),
  host_id: z.string().uuid().or(z.literal("")).transform((v) => v || null).optional().nullable(),
});

/** Anyone who holds the Events section may edit an event. */
async function requireEvents() {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" as const };
  const supabase = await createClient();
  const { data } = await supabase.rpc("bos_can_access", { p_section: "events" });
  if (data !== true && !(await isAdmin())) return { error: "Not authorised" as const };
  return { user };
}

export async function saveEvent(id: string | null, input: unknown) {
  const gate = await requireEvents();
  if ("error" in gate) return gate;

  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;

  const supabase = await createClient();

  // A free event has no price; letting the two disagree is how a page ends up
  // advertising "Free" beside an amount.
  const amount = v.price_type === "Free" ? 0 : v.price_amount;

  const { data: slug } = await supabase.rpc("bos_event_slug", {
    p_title: v.title,
    p_id: id,
  });

  const row = {
    ...v,
    price_amount: amount,
    price_label: v.price_type === "Free" ? "Free" : v.price_label || `₹${Math.round(amount / 100)}`,
    end_date: v.end_date || null,
    slug: (slug as string) ?? undefined,
    // published_at is what the website orders by, so it is set the first time
    // a row actually goes live and left alone after that.
    ...(v.status === "published" ? { published_at: new Date().toISOString() } : {}),
  };

  if (id) {
    const { data: before } = await supabase.from("events").select("*").eq("id", id).maybeSingle();
    // Do not keep re-stamping published_at on every later edit.
    if (before?.published_at) delete (row as { published_at?: string }).published_at;
    const { error } = await supabase.from("events").update(row).eq("id", id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("events").insert({ ...row, source: "admin" });
    if (error) return { error: error.message };
  }

  revalidatePath("/shreex/events");
  revalidatePath("/events");
  if (id) revalidatePath(`/shreex/events/${id}`);
  return { success: true };
}

/** Publish, unpublish or cancel without opening the whole form. */
export async function setEventStatus(id: string, status: string) {
  const gate = await requireEvents();
  if ("error" in gate) return gate;
  const allowed = ["draft", "pending_review", "approved", "published", "cancelled", "completed"];
  if (!allowed.includes(status)) return { error: "Unknown status" };

  const supabase = await createClient();
  const { data: before } = await supabase.from("events").select("published_at").eq("id", id).maybeSingle();
  const { error } = await supabase
    .from("events")
    .update({
      status,
      ...(status === "published" && !before?.published_at
        ? { published_at: new Date().toISOString() }
        : {}),
    })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/shreex/events");
  revalidatePath("/events");
  revalidatePath(`/shreex/events/${id}`);
  return { success: true };
}
