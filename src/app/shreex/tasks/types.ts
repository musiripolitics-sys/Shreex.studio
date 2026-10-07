import type { BosStatus, BosPriority, BosFrequency } from "@/lib/bos";
import type { ApprovalState } from "../roadmap/types";

export type TaskView =
  | "today"
  | "week"
  | "month"
  | "overdue"
  | "upcoming"
  | "completed"
  | "blocked"
  | "all";

export type Task = {
  id: string;
  code: string | null;
  workstream_id: string | null;
  goal_id: string | null;
  title: string;
  description: string | null;
  owner_id: string | null;
  frequency: BosFrequency;
  start_date: string | null;
  due_date: string | null;
  status: BosStatus;
  priority: BosPriority;
  dependency_id: string | null;
  budget: number;
  actual_cost: number;
  target: number | null;
  estimate_hours: number | null;
  actual_hours: number | null;
  completed_at: string | null;
  actual: number | null;
  comments: string | null;
  created_at: string;
  approval_state: ApprovalState;
  decision_note: string | null;
};
