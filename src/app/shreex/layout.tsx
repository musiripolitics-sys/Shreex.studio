import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getMySections } from "@/lib/os-access";
import { productLabels } from "@/lib/os-products";
import { loadMyTenants, isPlatformOwner } from "@/lib/os-tenants";
import { createClient } from "@/lib/supabase/server";
import { OsShell } from "@/components/os/OsShell";

export const metadata = { title: "Shreex" };

/**
 * The Shreex runs in its own shell rather than inside AppShell. Nesting
 * it there meant every page carried the app sidebar and a wall of module pills
 * at the same time; Chrome now routes /shreex/** straight through to this.
 */
export default async function OsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/shreex");

  // The OS is no longer admin-only: an employee granted any section may use
  // it. Someone with no grants at all still has nothing to open, so they are
  // told rather than shown an empty shell.
  const admin = await isAdmin();
  const [sections, productNames, tenants, platformOwner] = await Promise.all([
    getMySections(),
    productLabels(),
    loadMyTenants(),
    // Decides whether the tenant switcher appears at all on a single-business
    // install: for an owner it is also the door to the organisations page.
    isPlatformOwner(),
  ]);
  if (!admin && sections.length === 0) {
    return (
      <div className="mx-auto max-w-md px-5 py-24 text-center">
        <h1 className="font-display text-2xl font-bold text-fg">No access yet</h1>
        <p className="mt-2 text-sm text-muted">
          You&apos;re signed in as {user.email}, but no Shreex sections have
          been assigned to you. Ask an admin to grant the ones you need.
        </p>
      </div>
    );
  }

  // Badge counts for the top bar. A badge that is always there stops being a
  // signal, so both are omitted at zero; a failed count shows nothing rather
  // than a wrong number.
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const [approvals, overdueTasks, criticalRisks] = await Promise.all([
    supabase
      .from("approvals")
      .select("id", { count: "exact", head: true })
      .eq("decision", "pending"),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .lt("due_date", today)
      .not("status", "in", "(completed,cancelled)"),
    supabase
      .from("risks")
      .select("id", { count: "exact", head: true })
      .gte("risk_score", 15)
      .not("status", "in", "(completed,cancelled)"),
  ]);

  return (
    <OsShell
      email={user.email ?? ""}
      isAdmin={admin}
      sections={sections}
      productNames={productNames}
      tenants={tenants}
      canCreateTenant={platformOwner}
      approvalCount={approvals.count ?? 0}
      alertCount={(overdueTasks.count ?? 0) + (criticalRisks.count ?? 0)}
    >
      {children}
    </OsShell>
  );
}
