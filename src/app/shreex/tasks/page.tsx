import { createClient } from "@/lib/supabase/server";
import { TasksClient } from "./TasksClient";
import type { Task, TaskView } from "./types";
import type { Workstream, OwnerOption, Goal, RoadmapTask, TaskEdge } from "../roadmap/types";
import type { TaskComment } from "../roadmap/TaskDetail";
import { requireSection, scopeToMe } from "@/lib/os-access";
import { isAdmin } from "@/lib/auth";
import { loadDirectory } from "@/lib/os-directory";
import { readTasks } from "@/lib/os-tasks";

export const metadata = { title: "Tasks · Shreex" };

type SP = Promise<Record<string, string | string[] | undefined>>;

const V: TaskView[] = ["today", "week", "month", "overdue", "upcoming", "completed", "blocked", "all"];

export default async function TasksPage({ searchParams }: { searchParams: SP }) {
  await requireSection("plan");
  const mine = await scopeToMe();
  const admin = await isAdmin();
  const sp = await searchParams;
  const raw = typeof sp.view === "string" ? sp.view : "all";
  const view: TaskView = (V as string[]).includes(raw) ? (raw as TaskView) : "all";

  const supabase = await createClient();
  const [{ data: tasks }, { data: workstreams }, { data: goals }, owners, allTasks, edgesRes, commentsRes] =
    await Promise.all([
      // An employee sees the work assigned to them, not the whole plan.
      // select("*") already brings the new columns where they exist, and
      // simply omits them where they do not, so this one needs no fallback.
      (mine
        ? supabase.from("tasks").select("*").eq("owner_id", mine)
        : supabase.from("tasks").select("*")
      ).order("due_date", { ascending: true, nullsFirst: false }),
      supabase.from("workstreams").select("id,key,name,color").order("sort_order"),
      // The whole goal, not just its name: the detail panel shows which
      // roadmap objective a task belongs to.
      supabase.from("goals").select("*").order("created_at"),
      loadDirectory(supabase),
      // Deliberately NOT filtered to the signed-in employee. The panel has to
      // resolve a blocker owned by somebody else, or it reads "waiting on
      // something". RLS already limits this to what they may see.
      readTasks<RoadmapTask>(
        (cols) =>
          supabase.from("tasks").select(cols).order("due_date", { ascending: true, nullsFirst: false }),
        "id,code,goal_id,title,description,owner_id,start_date,due_date,status,priority,dependency_id,estimate_hours,actual_hours,completed_at",
      ),
      supabase.from("dependencies").select("id,from_id,to_id,note,status"),
      supabase
        .from("task_comments")
        .select("id,task_id,author_id,body,created_at")
        .order("created_at", { ascending: true }),
    ]);

  return (
    <TasksClient
      isAdmin={admin}
      initialTasks={(tasks as Task[]) ?? []}
      workstreams={(workstreams as Workstream[]) ?? []}
      goals={(goals as Goal[]) ?? []}
      owners={owners as OwnerOption[]}
      allTasks={allTasks}
      edges={(edgesRes.data as TaskEdge[]) ?? []}
      comments={(commentsRes.data as TaskComment[]) ?? []}
      initialView={view}
    />
  );
}
