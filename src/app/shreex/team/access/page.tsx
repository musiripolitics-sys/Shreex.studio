import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SECTION_KEYS, SECTION_LABELS } from "@/lib/os-access";
import { isPlatformOwner, loadMyTenants } from "@/lib/os-tenants";
import {
  AccessClient, type PersonRow, type ProductRow,
  type TenantProductRow, type InvitationRow,
} from "./AccessClient";

export const metadata = { title: "Team & Access · Shreex" };

/**
 * Who can open what. Admin-only, and guarded here rather than by
 * requireSection, because access management is not itself a grantable
 * section — an employee granted "Team" must not be able to grant themselves
 * the rest.
 */
export default async function AccessPage() {
  if (!(await isAdmin())) redirect("/shreex");

  const supabase = await createClient();
  // Staff only. Members are customers of the public site and have no business
  // in the OS; pulling them in here made the page mostly noise.
  const [
    { data: users }, grantsRes, profilesRes, productsRes,
    tenantProductsRes, invitationsRes, membersRes, platformOwner, myTenants,
  ] = await Promise.all([
    supabase
      .from("users")
      .select("id,full_name,email,primary_role,created_at")
      .in("primary_role", ["admin", "employee"])
      .order("primary_role")
      .order("full_name"),
    supabase.from("employee_module_access").select("user_id,section"),
    supabase.from("employee_profiles").select("user_id,title,department,status"),
    // The product catalogue. Read here rather than through os-products so the
    // page can tell a missing table from an empty one and say which migration
    // is outstanding.
    supabase
      .from("products")
      .select("key,name,description,is_enabled")
      .order("sort_order")
      .order("key"),
    // The catalogue as THIS business sees it. 0050 seeded tenant_products and
    // nothing read it, so until 0051 every business showed all nine products
    // whatever its rows said.
    supabase.rpc("bos_tenant_products"),
    // Pending invitations to this business. Scoped by the 0047 policy rather
    // than by a filter here, so a stale tenant in the client cannot widen it.
    supabase
      .from("tenant_invitations")
      .select("id,email,role,sections,token,created_at,expires_at")
      .is("accepted_at", null)
      .order("created_at", { ascending: false }),
    // Role per BUSINESS, which since 0047 is the only authority. users.primary_role
    // is a mirror of the default business and wrong for anybody else.
    supabase.from("tenant_members").select("user_id,role,status").eq("status", "active"),
    isPlatformOwner(),
    loadMyTenants(),
  ]);

  const productsMigrated = !productsRes.error && (productsRes.data?.length ?? 0) > 0;
  const products: ProductRow[] = productsMigrated
    ? (productsRes.data as ProductRow[])
    : SECTION_KEYS.map((key) => ({
        key,
        name: SECTION_LABELS[key],
        description: null,
        is_enabled: true,
      }));

  const profiles = new Map(
    ((profilesRes.data as { user_id: string; title: string | null; department: string | null; status: string }[]) ?? [])
      .map((r) => [r.user_id, r]),
  );

  const bySection = new Map<string, string[]>();
  for (const g of (grantsRes.data as { user_id: string; section: string }[]) ?? []) {
    bySection.set(g.user_id, [...(bySection.get(g.user_id) ?? []), g.section]);
  }

  const people: PersonRow[] = (
    (users as {
      id: string;
      full_name: string | null;
      email: string | null;
      primary_role: string;
      created_at: string;
    }[]) ?? []
  )
    .map((u) => ({
      id: u.id,
      name: u.full_name,
      email: u.email,
      role: u.primary_role,
      joined: u.created_at,
      title: profiles.get(u.id)?.title ?? null,
      department: profiles.get(u.id)?.department ?? null,
      sections: bySection.get(u.id) ?? [],
    }))
    // Anyone offboarded keeps their account but leaves this list.
    .filter((u) => profiles.get(u.id)?.status !== "ended");

  // tenant_members.role wins over users.primary_role wherever it exists.
  const memberRole = new Map(
    ((membersRes.data as { user_id: string; role: string }[]) ?? []).map((m) => [m.user_id, m.role]),
  );
  const peopleWithTenantRole = people.map((p) => ({
    ...p,
    role: memberRole.get(p.id) ?? p.role,
    inThisBusiness: memberRole.has(p.id),
  }));

  const tenantProducts = (tenantProductsRes.error ? [] : (tenantProductsRes.data ?? [])) as TenantProductRow[];
  const invitations = (invitationsRes.error ? [] : (invitationsRes.data ?? [])) as InvitationRow[];

  return (
    <AccessClient
      people={peopleWithTenantRole}
      products={products}
      migrated={!grantsRes.error}
      productsMigrated={productsMigrated}
      tenantProducts={tenantProducts}
      tenantProductsMigrated={!tenantProductsRes.error}
      invitations={invitations}
      invitationsMigrated={!invitationsRes.error}
      platformOwner={platformOwner}
      businessName={myTenants.find((t) => t.is_active)?.name ?? myTenants[0]?.name ?? "this business"}
    />
  );
}
