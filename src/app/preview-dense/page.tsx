import { PlatformClient } from "../shreex/platform/PlatformClient";
import { PlatformTopBar } from "../shreex/platform/PlatformTopBar";

/**
 * The real platform console, rendered with fixture props and no database.
 *
 * It renders the ACTUAL component rather than a mock of it, so what is on
 * screen here is what a super admin sees. Scaffolding: deleted once the design
 * is signed off.
 */
export const metadata = { title: "Preview · Shreex", robots: { index: false } };

const orgs = [
  { id: "t1", slug: "techxfluence", name: "Techxfluence", status: "active" as const, role: "super_admin",
    is_default: true, is_active: true, member_count: 11, product_count: 9, created_at: "2026-01-14T00:00:00Z" },
  { id: "t2", slug: "jilo", name: "Jilo", status: "active" as const, role: "super_admin",
    is_default: false, is_active: false, member_count: 0, product_count: 9, created_at: "2026-10-02T00:00:00Z" },
  { id: "t3", slug: "txf-service", name: "TFX Service", status: "active" as const, role: "super_admin",
    is_default: false, is_active: false, member_count: 2, product_count: 4, created_at: "2026-10-05T00:00:00Z" },
  { id: "t4", slug: "northwind", name: "Northwind Labs", status: "suspended" as const, role: "super_admin",
    is_default: false, is_active: false, member_count: 6, product_count: 9, created_at: "2026-06-21T00:00:00Z" },
];

const tenantAdmins = [
  { tenant_id: "t1", user_id: "u2", email: "priya@techxfluence.com", full_name: "Priya R", role: "admin", joined_at: "2026-02-01T00:00:00Z" },
  { tenant_id: "t3", user_id: "u3", email: "ops@tfxservice.com", full_name: "Ops Desk", role: "admin", joined_at: "2026-10-06T00:00:00Z" },
];

const platformAdmins = [
  { user_id: "u1", email: "admin@techxfluence.com", full_name: "Kumaresan", role: "super_admin" as const,
    granted_at: "2026-10-07T00:00:00Z", expires_at: null, granted_by_email: null, is_expired: false },
  { user_id: "u9", email: "support@vendor.io", full_name: "Vendor Support", role: "support" as const,
    granted_at: "2026-10-07T00:00:00Z", expires_at: "2026-10-14T00:00:00Z", granted_by_email: "admin@techxfluence.com", is_expired: false },
];

export default function Preview() {
  return (
    <main id="main" className="min-h-dvh bg-ink">
      <PlatformTopBar
        email="admin@techxfluence.com"
        tenants={[
          { id: "t1", slug: "techxfluence", name: "Techxfluence", role: "super_admin", is_active: true },
          { id: "t2", slug: "jilo", name: "Jilo", role: "super_admin", is_active: false },
          { id: "t3", slug: "txf-service", name: "TFX Service", role: "super_admin", is_active: false },
        ]}
      />
      <div className="mx-auto max-w-5xl px-4 py-4 md:px-6">
        <PlatformClient
          orgs={orgs}
          platformAdmins={platformAdmins}
          tenantAdmins={tenantAdmins}
          stats={{ tenants: 4, tenants_active: 3, tenants_suspended: 1, members: 19, admins: 3,
                   tenants_without_admin: 2, platform_admins: 1, products: 9 }}
          consoleMigrated
          me="u1"
          products={[
            { key: "plan", name: "Plan" }, { key: "events", name: "Events" },
            { key: "money", name: "Money" }, { key: "grow", name: "Grow" },
            { key: "marketing", name: "Marketing" }, { key: "team", name: "Team" },
            { key: "product", name: "Product" }, { key: "govern", name: "Govern" },
            { key: "insights", name: "Insights" },
          ]}
        />
      </div>
    </main>
  );
}
