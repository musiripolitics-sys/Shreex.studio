import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * The sprint, read through the functions 0056 added.
 *
 * Every number here arrives with something that checks it. Throughput on its
 * own rewards speed over value, and velocity is the metric teams reach for
 * because it is easy to calculate rather than because it decides anything — so
 * committed hours never travel without carry-over, overrun and the count of
 * unestimated stories beside them.
 */

export type SprintMetrics = {
  sprint: string | null;
  number?: number;
  goal?: string | null;
  status?: "planned" | "active" | "closed";
  starts_on?: string;
  ends_on?: string;
  /** 1 to 7, saturating. "Day 23 of 7" helps nobody. */
  day?: number;
  stories?: number;
  done?: number;
  in_progress?: number;
  not_started?: number;
  blocked?: number;
  committed_hours?: number;
  done_hours?: number;
  actual_hours?: number;
  unestimated?: number;
  overrun_hours?: number;
  overdue?: number;
  carried_out?: number | null;
};

export type SprintHistoryRow = {
  id: string;
  number: number;
  starts_on: string;
  status: string;
  stories: number;
  done: number;
  committed_hours: number;
  done_hours: number;
  actual_hours: number;
  carried_out: number | null;
};

const nums = (o: Record<string, unknown>, keys: string[]) => {
  const out: Record<string, unknown> = { ...o };
  for (const k of keys) if (out[k] != null) out[k] = Number(out[k]);
  return out;
};

const METRIC_NUMBERS = [
  "number", "day", "stories", "done", "in_progress", "not_started", "blocked",
  "committed_hours", "done_hours", "actual_hours", "unestimated", "overrun_hours",
  "overdue", "carried_out",
];

/** This week's sprint in numbers, or `{ sprint: null }` if nobody started one. */
export const loadSprint = cache(async (sprintId?: string): Promise<SprintMetrics> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bos_sprint_metrics", {
    p_sprint: sprintId ?? null,
  });
  if (error || !data || typeof data !== "object") return { sprint: null };
  return nums(data as Record<string, unknown>, METRIC_NUMBERS) as SprintMetrics;
});

/** The last few sprints. One sprint's velocity is noise; the shape is the signal. */
export const loadSprintHistory = cache(async (limit = 8): Promise<SprintHistoryRow[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bos_sprint_history", { p_limit: limit });
  if (error || !Array.isArray(data)) return [];
  return (data as Record<string, unknown>[]).map(
    (r) => nums(r, ["number", "stories", "done", "committed_hours", "done_hours", "actual_hours", "carried_out"]),
  ) as SprintHistoryRow[];
});

export type SprintNote = {
  id: string;
  kind: "refinement" | "review" | "retro_good" | "retro_bad" | "retro_action";
  body: string;
  author_id: string | null;
  created_at: string;
};

export const loadSprintNotes = cache(async (sprintId: string): Promise<SprintNote[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sprint_notes")
    .select("id,kind,body,author_id,created_at")
    .eq("sprint_id", sprintId)
    .order("created_at", { ascending: true });
  if (error || !Array.isArray(data)) return [];
  return data as SprintNote[];
});

/**
 * Red, amber or green for a sprint.
 *
 * Thresholds rather than opinion, and they are about the WEEK rather than the
 * work: a sprint is red when it cannot finish, amber when it is drifting,
 * green when the burn is ahead of the clock. Expressed as "should be done by
 * now" because a sprint on day 4 of 5 with half its hours left is in trouble
 * whatever the raw percentage says.
 */
export function sprintRag(m: SprintMetrics): { tone: "good" | "warn" | "bad"; why: string } {
  const committed = m.committed_hours ?? 0;
  const done = m.done_hours ?? 0;
  const day = m.day ?? 1;
  if (!m.sprint) return { tone: "warn", why: "no sprint started" };
  if ((m.blocked ?? 0) > 0) return { tone: "bad", why: `${m.blocked} blocked` };
  if (committed === 0) return { tone: "warn", why: "nothing committed" };

  const expected = committed * Math.min(day / 5, 1); // five working days
  if (done >= expected) return { tone: "good", why: "ahead of the clock" };
  const behind = Math.round(((expected - done) / committed) * 100);
  return behind > 25
    ? { tone: "bad", why: `${behind}% behind the burn` }
    : { tone: "warn", why: `${behind}% behind the burn` };
}
