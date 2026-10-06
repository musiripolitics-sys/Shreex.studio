import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * The businesses the signed-in person belongs to.
 *
 * Stage 7 of the BOS Product Model plan. Read through bos_my_tenants, which
 * is deliberately NOT scoped to one tenant: listing them across businesses is
 * what makes switching possible, and it is why tenant_members has no
 * isolation policy of its own.
 */

export type Tenant = {
  id: string;
  slug: string;
  name: string;
  role: string;
  is_active: boolean;
};

/**
 * cache() dedupes this per request, so the shell and any page that wants it
 * share one round trip.
 *
 * Returns an empty list on a database without 0047 rather than throwing. The
 * switcher then renders nothing, which is the correct appearance for an
 * install with one business: there is nothing to switch to.
 */
export const loadMyTenants = cache(async (): Promise<Tenant[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bos_my_tenants");
  if (error || !Array.isArray(data)) return [];
  return data as Tenant[];
});
