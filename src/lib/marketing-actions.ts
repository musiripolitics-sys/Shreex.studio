"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";

/**
 * Marketing writes, for the four sections that share one grant.
 *
 * Each page keeps its own shape of record, but the gate and the revalidation
 * are identical, so they live together rather than being copied four times.
 */
async function gate() {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" as const };
  const supabase = await createClient();
  const { data } = await supabase.rpc("bos_can_access", { p_section: "marketing" });
  if (data !== true && !(await isAdmin())) return { error: "Not authorised" as const };
  return { user, supabase };
}

const touch = () => {
  for (const p of ["content", "campaigns", "podcast", "competitors"]) {
    revalidatePath(`/admin/os/${p}`);
  }
};

const STATUSES = ["not_started", "in_progress", "blocked", "completed", "on_hold", "cancelled"] as const;
const nullableUuid = z.string().uuid().or(z.literal("")).transform((v) => v || null).optional().nullable();
const nullableDate = z.string().optional().nullable().transform((v) => v || null);

// ─────────────────────────────── Content ───────────────────────────────

const contentSchema = z.object({
  topic: z.string().trim().min(1, "What is it about?"),
  content_date: nullableDate,
  platform: z.string().trim().optional().nullable(),
  content_type: z.string().trim().optional().nullable(),
  pillar: z.string().trim().optional().nullable(),
  audience: z.string().trim().optional().nullable(),
  cta: z.string().trim().optional().nullable(),
  campaign_id: nullableUuid,
  owner_id: nullableUuid,
  status: z.enum(STATUSES).default("not_started"),
  asset_url: z.string().trim().optional().nullable(),
  reach: z.coerce.number().int().min(0).optional().nullable(),
  engagement: z.coerce.number().int().min(0).optional().nullable(),
  leads: z.coerce.number().int().min(0).optional().nullable(),
});

export async function saveContent(id: string | null, input: unknown) {
  const g = await gate();
  if ("error" in g) return g;
  const parsed = contentSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const { error } = id
    ? await g.supabase.from("content_items").update(parsed.data).eq("id", id)
    : await g.supabase.from("content_items").insert(parsed.data);
  if (error) return { error: error.message };
  touch();
  return { success: true };
}

/** Moving a card on the board, which is the common case and deserves one call. */
export async function setContentStatus(id: string, status: string) {
  const g = await gate();
  if ("error" in g) return g;
  if (!(STATUSES as readonly string[]).includes(status)) return { error: "Unknown status" };
  const { error } = await g.supabase.from("content_items").update({ status }).eq("id", id);
  if (error) return { error: error.message };
  touch();
  return { success: true };
}

/** Dragging a piece to another day on the calendar. */
export async function setContentDate(id: string, date: string) {
  const g = await gate();
  if ("error" in g) return g;
  const { error } = await g.supabase
    .from("content_items")
    .update({ content_date: date || null })
    .eq("id", id);
  if (error) return { error: error.message };
  touch();
  return { success: true };
}

export async function deleteContent(id: string) {
  const g = await gate();
  if ("error" in g) return g;
  const { error } = await g.supabase.from("content_items").delete().eq("id", id);
  if (error) return { error: error.message };
  touch();
  return { success: true };
}

// ────────────────────────────── Campaigns ──────────────────────────────

const campaignSchema = z.object({
  name: z.string().trim().min(1, "A name is required"),
  code: z.string().trim().optional().nullable(),
  channel: z.string().trim().optional().nullable(),
  campaign_type: z.string().trim().optional().nullable(),
  objective: z.string().trim().optional().nullable(),
  audience: z.string().trim().optional().nullable(),
  owner_id: nullableUuid,
  start_date: nullableDate,
  end_date: nullableDate,
  budget: z.coerce.number().int().min(0).default(0),
  actual_spend: z.coerce.number().int().min(0).default(0),
  target_reach: z.coerce.number().int().min(0).default(0),
  actual_reach: z.coerce.number().int().min(0).default(0),
  target_leads: z.coerce.number().int().min(0).default(0),
  actual_leads: z.coerce.number().int().min(0).default(0),
  target_conversions: z.coerce.number().int().min(0).default(0),
  actual_conversions: z.coerce.number().int().min(0).default(0),
  revenue_generated: z.coerce.number().int().min(0).default(0),
  status: z.enum(STATUSES).default("not_started"),
});

export async function saveCampaign(id: string | null, input: unknown) {
  const g = await gate();
  if ("error" in g) return g;
  const parsed = campaignSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const { error } = id
    ? await g.supabase.from("campaigns").update(parsed.data).eq("id", id)
    : await g.supabase.from("campaigns").insert(parsed.data);
  if (error) return { error: error.message };
  touch();
  return { success: true };
}

// ─────────────────────────────── Podcast ───────────────────────────────

const episodeSchema = z.object({
  number: z.coerce.number().int().min(0).optional().nullable(),
  title: z.string().trim().min(1, "A title is required"),
  guest: z.string().trim().optional().nullable(),
  topic: z.string().trim().optional().nullable(),
  recording_date: nullableDate,
  editing_status: z.string().trim().default("not_started"),
  publishing_status: z.string().trim().default("not_started"),
  youtube_status: z.string().trim().default("not_started"),
  shorts_target: z.coerce.number().int().min(0).default(0),
  shorts_published: z.coerce.number().int().min(0).default(0),
  views: z.coerce.number().int().min(0).default(0),
  leads: z.coerce.number().int().min(0).default(0),
  budget: z.coerce.number().int().min(0).default(0),
  actual_cost: z.coerce.number().int().min(0).default(0),
});

export async function saveEpisode(id: string | null, input: unknown) {
  const g = await gate();
  if ("error" in g) return g;
  const parsed = episodeSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const { error } = id
    ? await g.supabase.from("podcast_episodes").update(parsed.data).eq("id", id)
    : await g.supabase.from("podcast_episodes").insert(parsed.data);
  if (error) return { error: error.message };
  touch();
  return { success: true };
}

/** One stage of one episode, straight from the pipeline. */
export async function setEpisodeStage(id: string, field: string, value: string) {
  const g = await gate();
  if ("error" in g) return g;
  if (!["editing_status", "publishing_status", "youtube_status"].includes(field)) {
    return { error: "Unknown stage" };
  }
  const { error } = await g.supabase.from("podcast_episodes").update({ [field]: value }).eq("id", id);
  if (error) return { error: error.message };
  touch();
  return { success: true };
}

// ────────────────────────────── Competitors ─────────────────────────────

const competitorSchema = z.object({
  name: z.string().trim().min(1, "A name is required"),
  category: z.string().trim().optional().nullable(),
  offer: z.string().trim().optional().nullable(),
  business_model: z.string().trim().optional().nullable(),
  pricing: z.string().trim().optional().nullable(),
  target_audience: z.string().trim().optional().nullable(),
  strengths: z.string().trim().optional().nullable(),
  gaps: z.string().trim().optional().nullable(),
  our_response: z.string().trim().optional().nullable(),
  review_date: nullableDate,
});

export async function saveCompetitor(id: string | null, input: unknown) {
  const g = await gate();
  if ("error" in g) return g;
  const parsed = competitorSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const { error } = id
    ? await g.supabase.from("competitors").update(parsed.data).eq("id", id)
    : await g.supabase.from("competitors").insert(parsed.data);
  if (error) return { error: error.message };
  touch();
  return { success: true };
}
