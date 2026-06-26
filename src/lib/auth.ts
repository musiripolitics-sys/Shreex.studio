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
