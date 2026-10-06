import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OS_SECTIONS } from "@/lib/os-modules";

/**
 * The product keys this build has pages for. "Today" is not one — everyone
 * with OS access gets the dashboard, alerts and approvals.
 *
 * Since Stage 1 of the BOS Product Model plan the catalogue lives in
 * public.products and is read through @/lib/os-products. This list is the
 * other half of that split: a product exists and is enabled as DATA, but its
 * routes are CODE, and nothing in a table can conjure a React page. So this
 * is what the app can route to, not what the install has.
 *
 * A key here with no catalogue row is not rendered; a catalogue row whose key
 * is not here has nothing to link to yet. Neither is an error.
 */
export const SECTION_KEYS = [
  "plan", "events", "money", "grow", "marketing",
  "team", "product", "govern", "insights",
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

/**
 * Fallback display names, used before migration 0033 has run and as the seed
 * for the catalogue. The live names come from products.name via
 * productLabels(), so an admin renaming Govern to Compliance renames it in
 * the nav too.
 */
export const SECTION_LABELS: Record<SectionKey, string> = {
  plan: "Plan", events: "Events", money: "Money", grow: "Grow",
  marketing: "Marketing", team: "Team", product: "Product",
  govern: "Govern", insights: "Insights",
};

/**
 * Which product owns a given path. Derived from the nav rather than a second
 * hand-written list, so a page added to a group is guarded automatically.
 * Longest href wins, so /admin/os/events beats a shorter prefix.
 *
 * This used to match a nav group to a grant by lowercasing its label, which
 * meant renaming a group silently ungated every page under it. Groups now
 * carry their product key explicitly.
 */
export function sectionForPath(pathname: string): SectionKey | null {
  let best: { key: SectionKey; len: number } | null = null;
  const known = new Set<string>(SECTION_KEYS);
  for (const group of OS_SECTIONS) {
    if (!group.key || !known.has(group.key)) continue; // "Today" is ungated
    const key = group.key as SectionKey;
    for (const item of group.items) {
      if (pathname === item.href || pathname.startsWith(item.href + "/")) {
        if (!best || item.href.length > best.len) best = { key, len: item.href.length };
      }
    }
  }
  return best?.key ?? null;
}

/** Section keys the signed-in user may open. Admins get all nine. */
export async function getMySections(): Promise<SectionKey[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bos_my_sections");
  // On a database without 0016 the function is missing. Falling open would
  // hand everyone every section, so fail closed and let the admin check
  // short-circuit below keep the OS usable.
  if (error || !Array.isArray(data)) return [];
  return (data as string[]).filter((s): s is SectionKey =>
    (SECTION_KEYS as readonly string[]).includes(s),
  );
}

/**
 * Guard a page. Redirects to the dashboard when the section is not granted,
 * rather than showing an error — an employee following a stale link should
 * land somewhere useful, not on a wall.
 */
export async function requireSection(section: SectionKey): Promise<void> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bos_can_access", { p_section: section });
  if (error) {
    // Missing function means 0016 has not run; admins still pass through
    // their own check, so only un-migrated non-admins are turned away.
    const { data: admin } = await supabase.rpc("is_admin");
    if (admin === true) return;
    redirect("/admin/os?denied=" + section);
  }
  if (data !== true) redirect("/admin/os?denied=" + section);
}

/**
 * The user id to scope a page's queries to, or null for an admin.
 *
 * An employee sees their own work: the tasks assigned to them, the goals
 * those tasks belong to, and the dependencies and calendar entries that
 * follow. Admins see everything, so they scope to nothing.
 *
 * This filters what a page shows, not what the database will serve. The
 * "staff read" policies from 0007 deliberately still allow an employee to
 * read any task row, because a task blocked by somebody else's work has to
 * be able to name it — a board that says "waiting on something" is worse
 * than one that says what.
 */
export async function scopeToMe(): Promise<string | null> {
  const supabase = await createClient();
  const { data: admin } = await supabase.rpc("is_admin");
  if (admin === true) return null;
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}
