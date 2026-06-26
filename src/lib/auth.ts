import "server-only";
import { createClient } from "@/lib/supabase/server";

/** The currently authenticated Supabase user, or null. */
export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * Whether the current user has the `admin` role.
 * Uses the SECURITY DEFINER `is_admin()` SQL function so it works regardless
 * of row-level security on `user_roles`.
 */
export async function isAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("is_admin");
  return !error && data === true;
}

/** Whether the current user can host events (Host or Admin). */
export async function isHost(): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("is_host");
  return !error && data === true;
}

export type AppRole = "admin" | "host" | "member";

/**
 * The current user's effective role, used for theming and navigation.
 * Logged-out visitors are treated as `member` (orange / default theme).
 */
export async function getUserRole(): Promise<AppRole> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "member";

  const { data } = await supabase
    .from("users")
    .select("primary_role")
    .eq("id", user.id)
    .maybeSingle();

  const role = data?.primary_role;
  if (role === "admin") return "admin";
  if (role === "event_host") return "host";

  // Fall back to a user_roles admin grant (covers admins provisioned that way).
  const { data: adminRow } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("role", "admin")
    .maybeSingle();
  return adminRow ? "admin" : "member";
}
