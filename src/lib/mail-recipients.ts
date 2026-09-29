import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Look somebody up so they can be emailed.
 *
 * "read own profile" on public.users is `auth.uid() = id or is_admin()`, so a
 * signed-in caller cannot read anybody else's address. Every one of these
 * lookups therefore goes through the service role. Getting this wrong does not
 * raise anything — the query simply returns nothing and the email is quietly
 * never sent.
 */
export type Recipient = { id: string; email: string | null; full_name: string | null };

export function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function lookupUser(id: string | null | undefined): Promise<Recipient | null> {
  if (!id) return null;
  const db = serviceClient();
  if (!db) return null;
  const { data } = await db.from("users").select("id,email,full_name").eq("id", id).maybeSingle();
  return (data as Recipient) ?? null;
}

export const firstNameOf = (r: { full_name?: string | null; email?: string | null } | null) =>
  (r?.full_name || r?.email || "there").split(" ")[0];
