import { createClient } from "@/lib/supabase/server";
import { requireSection } from "@/lib/os-access";
import { loadDirectory } from "@/lib/os-directory";
import { loadSprint, loadSprintHistory, loadSprintNotes } from "@/lib/os-sprints";
import { SprintClient, type Story } from "./SprintClient";

export const metadata = { title: "Sprint · Shreex" };

/**
 * The week.
 *
 * This replaced a 90-day roadmap. Shreex runs on agile, so the unit is a
 * one-week sprint: Monday refinement, the work, review and retrospective at
 * the end, and every product feeding the same sprint rather than nine parallel
 * plans nobody reconciles.
 */
export default async function SprintPage() {
  await requireSection("plan");
  const supabase = await createClient();

  const metrics = await loadSprint();
  const [history, notes, directory, storiesRes, backlogRes] = await Promise.all([
    loadSprintHistory(8),
    metrics.sprint ? loadSprintNotes(metrics.sprint) : Promise.resolve([]),
    loadDirectory(supabase),
    metrics.sprint
      ? supabase
          .from("tasks")
          .select("id,code,title,status,priority,owner_id,due_date,estimate_hours,actual_hours")
          .eq("sprint_id", metrics.sprint)
          .order("status")
          .order("due_date", { ascending: true, nullsFirst: false })
      : Promise.resolve({ data: [], error: null }),
    // The backlog: anything not committed to a sprint and not finished. This is
    // what Monday refinement pulls from, so it is on the page rather than
    // behind a link.
    supabase
      .from("tasks")
      .select("id,code,title,status,priority,owner_id,due_date,estimate_hours,actual_hours")
      .is("sprint_id", null)
      .not("status", "in", "(completed,cancelled)")
      .order("priority")
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(40),
  ]);

  const names = new Map(directory.map((p) => [p.id, p.full_name || p.email || "—"]));
  const shape = (rows: unknown): Story[] =>
    ((rows as Record<string, unknown>[]) ?? []).map((t) => ({
      id: String(t.id),
      code: (t.code as string) ?? "",
      title: (t.title as string) ?? "",
      status: (t.status as string) ?? "not_started",
      priority: (t.priority as string) ?? "medium",
      owner: t.owner_id ? (names.get(String(t.owner_id)) ?? null) : null,
      due_date: (t.due_date as string) ?? null,
      estimate_hours: t.estimate_hours == null ? null : Number(t.estimate_hours),
      actual_hours: t.actual_hours == null ? null : Number(t.actual_hours),
    }));

  return (
    <SprintClient
      metrics={metrics}
      history={history}
      notes={notes}
      stories={shape(storiesRes.data)}
      backlog={shape(backlogRes.data)}
      // A missing function means 0056 has not run. Saying so beats rendering an
      // empty week and letting somebody conclude they have no work.
      migrated={metrics.sprint !== null || history.length > 0 || !storiesRes.error}
    />
  );
}
