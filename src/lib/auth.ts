import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * The currently authenticated Supabase user, or null.
 * cache() dedupes this per request — the layout, pages and helpers all share
 * ONE auth round trip instead of each firing their own.
 */
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/**
 * Whether the current user has the `admin` role.
 * Uses the SECURITY DEFINER `is_admin()` SQL function so it works regardless
 * of row-level security on `user_roles`.
 */
export const isAdmin = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("is_admin");
  return !error && data === true;
});

/** Whether the current user can host events (Host or Admin). */
export const isHost = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("is_host");
  return !error && data === true;
});

export type AppRole = "admin" | "host" | "member";

/**
 * The current user's effective role, used for theming and navigation.
 * Logged-out visitors are treated as `member` (orange / default theme).
 * Cached per request; the two role lookups run in parallel.
 */
export const getUserRole = cache(async (): Promise<AppRole> => {
  const user = await getCurrentUser();
  if (!user) return "member";

  const supabase = await createClient();
  const [{ data: profile }, { data: adminRow }] = await Promise.all([
    supabase.from("users").select("primary_role").eq("id", user.id).maybeSingle(),
    // Fallback admin grant via user_roles (covers admins provisioned that way).
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle(),
  ]);

  const role = profile?.primary_role;
  if (role === "admin" || adminRow) return "admin";
  if (role === "event_host") return "host";
  return "member";
});
