import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * The businesses the signed-in person belongs to.
 *
 * Stage 7 of the Shreex product model plan. Read through bos_my_tenants, which
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

/**
 * One business, with the two counts the organisations page shows.
 *
 * Unlike Tenant this carries status, because the page it feeds has to be
 * able to show you the business you suspended — a management surface that
 * hides what it just did to something is not a management surface.
 */
export type Organisation = {
  id: string;
  slug: string;
  name: string;
  status: "active" | "suspended" | "archived";
  role: string;
  is_default: boolean;
  is_active: boolean;
  member_count: number;
  product_count: number;
  created_at: string;
};

/** Every business the signed-in person belongs to. Empty without 0050. */
export const loadMyOrganisations = cache(async (): Promise<Organisation[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bos_my_tenant_summary");
  if (error || !Array.isArray(data)) return [];
  // The counts arrive as bigint, which PostgREST serialises as a string.
  return (data as Record<string, unknown>[]).map((r) => ({
    ...r,
    member_count: Number(r.member_count ?? 0),
    product_count: Number(r.product_count ?? 0),
  })) as Organisation[];
});

/**
 * Whether this person may create a business.
 *
 * Since 0047 every authority in the OS is per-tenant, which left the
 * platform itself with no owner — and creating a business is not an act
 * inside a business. 0050 settles it as admin of the tenant marked
 * is_default: whoever runs the original business runs the platform.
 *
 * Fails closed. A database without 0050 has no such function, and answering
 * true would show a create form whose submit could only ever fail.
 */
export const isPlatformOwner = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bos_is_platform_owner");
  if (error) return false;
  return data === true;
});

/** A platform administrator, from bos_platform_admins(). */
export type PlatformAdmin = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: "super_admin" | "support";
  granted_at: string;
  expires_at: string | null;
  granted_by_email: string | null;
  is_expired: boolean;
};

/**
 * Who runs the platform. Empty for anybody who does not, because the
 * authorisation is the WHERE clause inside bos_platform_admins rather than a
 * check out here — so a page cannot forget it.
 */
export const loadPlatformAdmins = cache(async (): Promise<PlatformAdmin[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bos_platform_admins");
  if (error || !Array.isArray(data)) return [];
  return data as PlatformAdmin[];
});

/** An administrator of one business, from bos_tenant_admin_list(). */
export type TenantAdmin = {
  tenant_id: string;
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  joined_at: string;
};

export const loadTenantAdmins = cache(async (): Promise<TenantAdmin[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bos_tenant_admin_list");
  if (error || !Array.isArray(data)) return [];
  return data as TenantAdmin[];
});

export type PlatformStats = {
  tenants?: number;
  tenants_active?: number;
  tenants_suspended?: number;
  members?: number;
  admins?: number;
  tenants_without_admin?: number;
  platform_admins?: number;
  products?: number;
};

/**
 * Counts across every business. Empty for anybody who is not a super admin —
 * bos_platform_stats returns an empty object rather than raising, so a page
 * that forgets to guard shows nothing instead of leaking.
 */
export const loadPlatformStats = cache(async (): Promise<PlatformStats> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bos_platform_stats");
  if (error || !data || typeof data !== "object") return {};
  const d = data as Record<string, unknown>;
  return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, Number(v)])) as PlatformStats;
});
