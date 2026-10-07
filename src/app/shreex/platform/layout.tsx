import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { isPlatformOwner, loadMyTenants } from "@/lib/os-tenants";
import { PlatformTopBar } from "./PlatformTopBar";

/**
 * The Super Admin console, and deliberately NOT under the Shreex layout.
 *
 * It used to be a page inside /shreex, which meant it inherited that
 * shell: the nine-product sidebar, the approvals badge, the notification bell
 * — all of which are about ONE business. A platform operator looking at three
 * organisations was being shown Techxfluence unread notifications, because
 * the shell had no idea it was being used above a tenant rather than inside
 * one. Nothing in here belongs to a business, so none of that chrome does.
 *
 * Gated on being a super admin rather than on a product grant. There is no
 * section that could express this: since 0047 every grant is per-tenant, and
 * this is the one surface that is not about a tenant.
 */
export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/shreex/platform");

  const [owner, tenants] = await Promise.all([isPlatformOwner(), loadMyTenants()]);
  if (!owner) {
    // Not a wall: somebody who administers a business has somewhere to be.
    redirect("/shreex/dashboard");
  }

  return (
    <div className="min-h-dvh bg-surface-2">
      <PlatformTopBar email={user.email ?? ""} tenants={tenants} />
      <main className="mx-auto max-w-5xl px-4 py-7 md:px-6">{children}</main>
      <footer className="mx-auto max-w-5xl px-4 pb-10 text-[11px] leading-relaxed text-faint md:px-6">
        You are signed in as a platform administrator. Everything here is about the platform
        rather than about any one business — to work inside a business, enter it from the menu
        above, which is written to that business audit log.{" "}
        <Link href="/shreex/dashboard" className="underline hover:text-fg">
          Shreex
        </Link>
      </footer>
    </div>
  );
}
