import type { BosStatus, BosPriority } from "@/lib/bos";

/** Where a task sits in the completion gate added by migration 0020. */
export type ApprovalState = "none" | "pending" | "approved" | "rejected";

export type Workstream = { id: string; key: string; name: string; color: string | null };
export type OwnerOption = { id: string; full_name: string | null; email: string | null };

export type Goal = {
  id: string;
  code: string | null;
  workstream_id: string | null;
  month: number | null;
  week: number | null;
  objective: string;
  deliverable: string | null;
  owner_id: string | null;
  start_date: string | null;
  end_date: string | null;
  priority: BosPriority;
  status: BosStatus;
  budget: number;
  target_kpi: string | null;
  actual_kpi: string | null;
  dependency_id: string | null;
  notes: string | null;
  created_at: string;
};

/** A task belonging to a roadmap goal, with its blocking predecessor resolved. */
export type RoadmapTask = {
  id: string;
  code: string | null;
  goal_id: string | null;
  title: string;
  description: string | null;
  owner_id: string | null;
  start_date: string | null;
  due_date: string | null;
  status: BosStatus;
  priority: BosPriority;
  dependency_id: string | null;
  estimate_hours: number | null;
  actual_hours: number | null;
  completed_at: string | null;
  approval_state: ApprovalState;
  decision_note: string | null;
};

/** An edge in the dependency graph: `from` waits on `to`. */
export type TaskEdge = {
  id: string;
  from_id: string | null;
  to_id: string | null;
  note: string | null;
  status: string;
};
