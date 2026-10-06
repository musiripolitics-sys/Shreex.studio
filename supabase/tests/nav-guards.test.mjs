/**
 * Guard: the catalogue, the nav and the page guards agree.
 *
 * Stage 1 of the BOS Product Model plan left two halves of one list — the
 * products table says what exists and is enabled, the code says what has
 * pages. They have to line up, and nothing about a mismatch is loud: a nav
 * group whose key is not in the catalogue renders a row nobody can open, and
 * a requireSection() naming a key that is not seeded redirects every visitor
 * away from a page that works.
 *
 * So this reads all three sources and compares them: the seed in migration
 * 0033, SECTION_KEYS and the nav groups in src/lib, and every
 * requireSection() literal across the app.
 */
import fs from "fs";
import path from "path";
import { freshDb, counter } from "./_db.mjs";

const { state, ok } = counter();
const read = (p) => fs.readFileSync(p, "utf8");

// ── 1. What the database holds ──
const { db } = await freshDb({ quiet: true });
const seeded = new Set(
  (await db.query(`select key from public.products order by key`)).rows.map((r) => r.key),
);

// ── 2. What the code can route to ──
const access = read("src/lib/os-access.ts");
const keysBlock = access.match(/export const SECTION_KEYS = \[([\s\S]*?)\] as const;/);
const sectionKeys = new Set([...(keysBlock?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));

const modules = read("src/lib/os-modules.ts");
const navBlock = modules.match(/export const OS_SECTIONS: NavSection\[\] = \[([\s\S]*)\n\];/);
const navKeys = new Set(
  [...(navBlock?.[1] ?? "").matchAll(/^\s{4}key: (?:"([a-z_]+)"|null),$/gm)]
    .map((m) => m[1])
    .filter(Boolean),
);

// ── 3. What the pages guard themselves with ──
const guards = new Map(); // key -> files
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (/\.tsx?$/.test(e.name)) {
      for (const m of read(f).matchAll(/requireSection\(\s*"([a-z_]+)"\s*\)/g)) {
        guards.set(m[1], [...(guards.get(m[1]) ?? []), f]);
      }
    }
  }
};
walk("src/app");

console.log("\nThe nine are declared once per layer and the layers match:");
ok(sectionKeys.size === 9, `SECTION_KEYS holds nine keys (${sectionKeys.size})`);
ok(seeded.size === 9, `migration 0033 seeds nine products (${seeded.size})`);
ok(navKeys.size === 9, `nine nav groups carry a product key (${navKeys.size})`);

const diff = (a, b) => [...a].filter((x) => !b.has(x));

console.log("\nEvery routable key has a catalogue row:");
const unseeded = diff(sectionKeys, seeded);
ok(unseeded.length === 0,
   unseeded.length === 0
     ? "SECTION_KEYS is a subset of the seed"
     : `NOT SEEDED: ${unseeded.join(", ")} — add to the insert in 0033_products.sql, or these products vanish from every nav`);

const unrouted = diff(seeded, sectionKeys);
ok(unrouted.length === 0,
   unrouted.length === 0
     ? "and the seed holds nothing the app cannot route to"
     : `NO ROUTE: ${unrouted.join(", ")} — seeded but absent from SECTION_KEYS, so nothing links to it`);

console.log("\nEvery nav group belongs to a product the app knows:");
const strayNav = diff(navKeys, sectionKeys);
ok(strayNav.length === 0,
   strayNav.length === 0
     ? "every group key is in SECTION_KEYS"
     : `STRAY GROUP: ${strayNav.join(", ")} — sectionForPath skips a group whose key it does not know, so every page under it would be ungated`);

const navless = diff(sectionKeys, navKeys);
ok(navless.length === 0,
   navless.length === 0
     ? "and every product has a group to render"
     : `NO NAV GROUP: ${navless.join(", ")}`);

console.log("\nEvery page guard names a product that exists:");
const badGuards = [...guards.keys()].filter((k) => !seeded.has(k));
ok(badGuards.length === 0,
   badGuards.length === 0
     ? `all ${guards.size} distinct keys used across ${[...guards.values()].flat().length} requireSection calls are seeded`
     : `UNKNOWN GUARD: ${badGuards.map((k) => `${k} in ${guards.get(k).join(", ")}`).join("; ")} — bos_can_access refuses a product that is not in the catalogue, so this page redirects everyone away`);

console.log("\nThe key list exists in exactly one place in the app:");
const copies = [];
for (const f of ["src/app/admin/os/actions.ts", "src/app/admin/os/team/access/AccessClient.tsx"]) {
  const src = read(f);
  // Nine quoted product keys in one literal is the shape of a fourth copy.
  const hits = [...src.matchAll(/\[(?:[^[\]]*"(?:plan|insights)"[^[\]]*){2,}\]/g)];
  if (hits.length) copies.push(f);
}
ok(copies.length === 0,
   copies.length === 0
     ? "neither the OS actions nor the access page lists the keys any more"
     : `DUPLICATE LIST: ${copies.join(", ")} — the catalogue is the list; reading it beats repeating it`);

console.log(`\n${state.pass} passed, ${state.fail} failed`);
process.exit(state.fail ? 1 : 0);
