import type { SupabaseClient } from "@supabase/supabase-js";

export type DirectoryEntry = {
  id: string;
  full_name: string | null;
  email: string | null;
  primary_role?: string | null;
};

const STAFF = ["admin", "employee", "event_host"];

/**
 * Who the Business OS is allowed to name.
 *
 * A plain select on `users` returns only the caller's own row to an employee —
 * "read own profile" is `auth.uid() = id or is_admin()` — so every colleague on
 * their roadmap renders "—", including the blocker 0018 went to such trouble to
 * make readable. `bos_user_directory()` (migration 0019) answers instead: names
 * for staff, emails for admins, members never.
 *
 * Until 0019 is applied the function does not exist, so this falls back to the
 * old query. That is right for an admin, who could always read `users`; an
 * employee still sees "—" until the migration runs.
 */
export async function loadDirectory(
  supabase: SupabaseClient,
  { staffOnly = true, limit = 500 }: { staffOnly?: boolean; limit?: number } = {},
): Promise<DirectoryEntry[]> {
  const rpc = supabase.rpc("bos_user_directory");
  const { data, error } = await (staffOnly ? rpc.in("primary_role", STAFF) : rpc)
    .order("full_name")
    .limit(limit);

  if (!error) return (data as DirectoryEntry[]) ?? [];

  const fallback = supabase.from("users").select("id,full_name,email,primary_role");
  const { data: rows } = await (staffOnly ? fallback.in("primary_role", STAFF) : fallback)
    .order("full_name")
    .limit(limit);
  return (rows as DirectoryEntry[]) ?? [];
}
