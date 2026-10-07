import { getCurrentUser } from "@/lib/auth";
import {
  loadMyOrganisations, loadPlatformAdmins, loadTenantAdmins, loadPlatformStats,
} from "@/lib/os-tenants";
import { loadProducts } from "@/lib/os-products";
import { PlatformClient } from "./PlatformClient";

export const metadata = { title: "Platform · Shreex", robots: { index: false } };

/**
 * Everything a platform operator does: the organisations, their status, who
 * administers each, and who runs the platform.
 *
 * The layout above has already established that the caller is a super admin,
 * and every function read here enforces it again independently — bos_platform_stats
 * returns an empty object to anybody else and bos_tenant_admin_list narrows to
 * the businesses they administer. The guard is not in one place on purpose.
 */
export default async function PlatformPage() {
  const user = await getCurrentUser();

  const [orgs, platformAdmins, tenantAdmins, stats, catalogue] = await Promise.all([
    loadMyOrganisations(),
    loadPlatformAdmins(),
    loadTenantAdmins(),
    loadPlatformStats(),
    // So a new business can be given only the products it needs, named the way
    // the catalogue names them rather than from a second hardcoded list.
    loadProducts(),
  ]);

  // 0053 absent means no stats and no per-business admin list. The page still
  // works from bos_my_tenant_summary, so it says what is missing rather than
  // rendering a console with empty panels and no explanation.
  const consoleMigrated = Object.keys(stats).length > 0;

  return (
    <PlatformClient
      orgs={orgs}
      platformAdmins={platformAdmins}
      tenantAdmins={tenantAdmins}
      stats={stats}
      consoleMigrated={consoleMigrated}
      me={user?.id ?? ""}
      products={catalogue.products.filter((p) => p.is_enabled).map((p) => ({ key: p.key, name: p.name }))}
    />
  );
}
