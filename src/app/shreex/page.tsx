import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/os-tenants";

/**
 * /shreex opens the console that is actually yours.
 *
 * A platform administrator lands on the platform console, because their job is
 * the businesses rather than the work inside one. Everybody else lands on their
 * business dashboard. That is why this is a router and not a page: "the Shreex
 * console" means a different surface depending on who opened it.
 *
 * The dashboard lives at its own path rather than here, which is the thing that
 * makes this safe. A redirect from /shreex to the platform console, with the
 * console "Enter a business" button pointing back at /shreex, is an infinite
 * loop — the super admin would be bounced out of every business they tried to
 * enter. With the dashboard at /shreex/dashboard the console has somewhere to
 * send them that this router never sees.
 */
export default async function ShreexIndex({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/shreex");

  // Carried through so a "you cannot open that section" bounce still arrives
  // with its reason attached.
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") qs.set(k, v);
    else if (Array.isArray(v) && v[0]) qs.set(k, v[0]);
  }
  const suffix = qs.size ? `?${qs.toString()}` : "";

  if (await isPlatformOwner()) redirect(`/shreex/platform${suffix}`);
  redirect(`/shreex/dashboard${suffix}`);
}
