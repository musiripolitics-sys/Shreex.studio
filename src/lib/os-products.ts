import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { SECTION_KEYS, SECTION_LABELS, type SectionKey } from "@/lib/os-access";

/**
 * The product catalogue.
 *
 * Stage 1 of the BOS Product Model plan. A product used to be a TypeScript
 * constant written out in four places — os-access.ts, the OS actions, the
 * access page, and a CHECK constraint in migration 0016. It is now a row in
 * public.products, and this is the only place the app reads it.
 *
 * What is data and what is code: a product EXISTS and is ENABLED as data; its
 * pages are code. No registry can conjure a React component, so SECTION_KEYS
 * remains the compile-time list of keys this codebase has pages for, and the
 * catalogue decides which of them are switched on and what they are called.
 */

export type Product = {
  key: string;
  name: string;
  description: string | null;
  surface: "os" | "public" | "both";
  sort_order: number;
  is_enabled: boolean;
};

/**
 * What to show before migration 0033 has run. Falling back to the nine keeps
 * the OS usable on a database that has not caught up yet — the same approach
 * readTasks takes when the approval columns are missing. Falling open on the
 * CATALOGUE is safe; the access check itself is bos_can_access, which stays
 * in the database and fails closed.
 */
const FALLBACK: Product[] = SECTION_KEYS.map((key, i) => ({
  key,
  name: SECTION_LABELS[key],
  description: null,
  surface: "os" as const,
  sort_order: (i + 1) * 10,
  is_enabled: true,
}));

/**
 * The whole catalogue, including disabled products, in display order.
 * cache() dedupes it per request, so the OS layout, the nav and a page guard
 * share one round trip.
 *
 * `migrated` is false when the table is absent OR empty, so a page can say
 * "run 0033" rather than silently showing the fallback as though it were real
 * data. Treating empty as unmigrated is deliberate: an install whose
 * catalogue has been emptied should fall back to the nine rather than render
 * an OS with no products at all.
 */
export const loadProducts = cache(
  async (): Promise<{ products: Product[]; migrated: boolean }> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("products")
      .select("key,name,description,surface,sort_order,is_enabled")
      .order("sort_order")
      .order("key");

    if (error || !data || data.length === 0) {
      return { products: FALLBACK, migrated: false };
    }
    return { products: data as Product[], migrated: true };
  },
);

/** Only the products that are switched on. What the nav and guards care about. */
export const enabledProducts = cache(async (): Promise<Product[]> => {
  const { products } = await loadProducts();
  return products.filter((p) => p.is_enabled);
});

/**
 * key → display name, for the nav and for any page naming a section. An admin
 * who renames Govern to Compliance renames it everywhere this is read.
 */
export const productLabels = cache(async (): Promise<Record<string, string>> => {
  const { products } = await loadProducts();
  return Object.fromEntries(products.map((p) => [p.key, p.name]));
});

/**
 * Catalogue keys that this build actually has pages for.
 *
 * A product row whose key has no route would render a nav entry leading to a
 * 404, so it is left out of the nav. The row is not wrong — it may be a
 * product that ships next week — it just has nothing to link to yet.
 */
export const routableProducts = cache(async (): Promise<SectionKey[]> => {
  const known = new Set<string>(SECTION_KEYS);
  return (await enabledProducts())
    .filter((p) => known.has(p.key))
    .map((p) => p.key as SectionKey);
});
