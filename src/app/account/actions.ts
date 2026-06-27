"use server";

import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";

/**
 * Permanently delete the signed-in user's account. Uses the service-role key
 * (admin API); the public.users row + related data cascade automatically.
 * The client should sign out + redirect afterwards.
 */
export async function deleteAccount(): Promise<{ success?: true; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "You're not signed in." };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return {
      error:
        "Account deletion isn't configured on the server (missing SUPABASE_SERVICE_ROLE_KEY).",
    };
  }

  const admin = createAdminClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return { error: error.message };

  return { success: true };
}
