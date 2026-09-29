/**
 * Task reads that survive a database without migration 0020.
 *
 * The pages select approval_state and decision_note. Where 0020 has not been
 * applied those columns do not exist, PostgREST fails the whole select, and
 * the Plan section would come back empty — a far worse failure than the one
 * it is reporting. So the read is tried with them and retried without.
 *
 * The fallback reports every task as already approved, which is exactly how
 * the OS behaved before the gate existed: nothing is blocked, because there
 * is nothing yet to enforce it.
 */
const APPROVAL = ",approval_state,decision_note";

type Result = { data: unknown; error: { message: string } | null };

export async function readTasks<T>(
  run: (cols: string) => PromiseLike<Result>,
  baseCols: string,
): Promise<T[]> {
  const withCols = await run(baseCols + APPROVAL);
  if (!withCols.error) return ((withCols.data as T[]) ?? []);

  const without = await run(baseCols);
  return (((without.data as Record<string, unknown>[]) ?? []).map((r) => ({
    ...r,
    approval_state: "approved",
    decision_note: null,
  })) as T[]);
}
