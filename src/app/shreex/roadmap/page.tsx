import { createClient } from "@/lib/supabase/server";
import { RoadmapClient } from "./RoadmapClient";
import type { Goal, Workstream, OwnerOption, RoadmapTask, TaskEdge } from "./types";
import type { TaskComment } from "./TaskDetail";
import { requireSection, scopeToMe } from "@/lib/os-access";
import { isAdmin } from "@/lib/auth";
import { loadDirectory } from "@/lib/os-directory";
import { readTasks } from "@/lib/os-tasks";

export const metadata = { title: "90-Day Roadmap · Shreex" };

export default async function RoadmapPage() {
  await requireSection("plan");
  const mine = await scopeToMe();
  const admin = await isAdmin();

  const supabaseForScope = await createClient();
  // An employee's roadmap is the goals they own plus the goals their tasks
  // hang off — a task without its goal has no context.
  let goalIds: string[] | null = null;
  if (mine) {
    const [{ data: ownTasks }, { data: ownGoals }] = await Promise.all([
      supabaseForScope.from("tasks").select("goal_id").eq("owner_id", mine),
      supabaseForScope.from("goals").select("id").eq("owner_id", mine),
    ]);
    goalIds = [
      ...new Set([
        ...((ownTasks as { goal_id: string | null }[]) ?? []).map((t) => t.goal_id).filter(Boolean),
        ...((ownGoals as { id: string }[]) ?? []).map((g) => g.id),
      ]),
    ] as string[];
  }
  const supabase = await createClient();

  const [{ data: goals }, { data: workstreams }, owners, roadmapTasks, edgesRes, commentsRes] = await Promise.all([
    (goalIds
      ? supabase.from("goals").select("*").in("id", goalIds.length ? goalIds : ["-"])
      : supabase.from("goals").select("*")
    )
      .order("month", { ascending: true, nullsFirst: true })
      .order("week", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: true }),
    supabase.from("workstreams").select("id,key,name,color").order("sort_order"),
    loadDirectory(supabase),
    // Tasks and the dependency graph load with the goals so expanding a row is
    // instant and needs no second round trip.
    readTasks<RoadmapTask>(
      (cols) =>
        supabase
          .from("tasks")
          .select(cols)
          .not("goal_id", "is", null)
          .order("due_date", { ascending: true, nullsFirst: false }),
      "id,code,goal_id,title,description,owner_id,start_date,due_date,status,priority,dependency_id,estimate_hours,actual_hours,completed_at",
    ),
    supabase.from("dependencies").select("id,from_id,to_id,note,status"),
    // Added by migration 0015; an un-migrated database simply shows no thread.
    supabase
      .from("task_comments")
      .select("id,task_id,author_id,body,created_at")
      .order("created_at", { ascending: true }),
  ]);

  return (
    <RoadmapClient
      isAdmin={admin}
      initialGoals={(goals as Goal[]) ?? []}
      workstreams={(workstreams as Workstream[]) ?? []}
      owners={owners as OwnerOption[]}
      tasks={roadmapTasks}
      edges={(edgesRes.data as TaskEdge[]) ?? []}
      comments={(commentsRes.data as TaskComment[]) ?? []}
    />
  );
}
