/**
 * Guard: no SECURITY DEFINER function reaches production unclassified.
 *
 * Stage 0 of the BOS Product Model plan. A definer function bypasses RLS by
 * design — that is why they exist, and on a single-tenant system it is
 * correct. Under tenancy each one is a potential cross-tenant read, and the
 * failure is silent: no error, just somebody else's rows.
 *
 * Auditing the 72 that exist today is necessary and not sufficient, because
 * the seventy-third gets written next month. This test reads pg_proc and
 * refuses anything that is not classified in
 * supabase/tenancy/definer-functions.json, so a new definer function ships
 * failing until somebody has decided what it does and who may see it.
 *
 * The companion check — run every row-spanning function as two tenants and
 * assert the results are disjoint — cannot run until a second tenant exists.
 * It lands in Stage 6, and until then this file reports it as pending rather
 * than printing a pass it has not earned.
 */
import fs from "fs";
import { freshDb, counter } from "./_db.mjs";

const inv = JSON.parse(fs.readFileSync("supabase/tenancy/definer-functions.json", "utf8"));
const { db, skipped } = await freshDb();
const { state, ok } = counter();
const q = async (s) => (await db.query(s)).rows;

ok(skipped.length === 0, `every migration applied cleanly (${skipped.length} failures)`);

const fns = await q(`
  select p.proname as name,
         pg_get_function_identity_arguments(p.oid) as args,
         p.proretset as retset,
         p.proconfig as cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
   order by p.proname, args`);

const sig = (f) => `${f.name}(${f.args})`;

console.log("\nEvery definer function is classified:");
const unknown = fns.filter((f) => !inv.functions[sig(f)]).map(sig);
ok(unknown.length === 0,
   unknown.length === 0
     ? `all ${fns.length} signatures appear in supabase/tenancy/definer-functions.json`
     : `UNCLASSIFIED: ${unknown.join(", ")} — this function bypasses RLS; classify it A to E in supabase/tenancy/definer-functions.json and say what scopes it`);

const live = new Set(fns.map(sig));
const stale = Object.keys(inv.functions).filter((s) => !live.has(s));
ok(stale.length === 0,
   stale.length === 0
     ? "and nothing is classified that no longer exists"
     : `STALE: ${stale.join(", ")} — remove from supabase/tenancy/definer-functions.json`);

console.log("\nEvery definer function pins its search_path:");
const loose = fns
  .filter((f) => !(f.cfg || []).some((c) => c.startsWith("search_path=")))
  .map(sig);
ok(loose.length === 0,
   loose.length === 0
     ? `all ${fns.length} carry "set search_path"`
     : `NO search_path: ${loose.join(", ")} — a definer function without a pinned search_path can be made to call a caller-supplied function with the owner's rights`);

console.log("\nbos_search stays SECURITY INVOKER:");
const search = await q(`
  select p.prosecdef as definer
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'bos_search'`);
ok(search.length > 0, "bos_search exists");
ok(search.every((r) => r.definer === false),
   "and is not security definer — it answers across sixteen record types with no filter of its own, so it relies entirely on RLS. Making it definer would switch off the only thing scoping it.");

console.log("\nWhat Stage 5 has to work through:");
const byGroup = {};
for (const [s, f] of Object.entries(inv.functions)) (byGroup[f.group] ??= []).push({ s, ...f });
for (const g of ["E", "B", "C", "D", "A"]) {
  const all = byGroup[g] ?? [];
  const unfiltered = all.filter((f) => f.scope === "all").length;
  console.log(`  ${g}: ${String(all.length).padStart(2)} functions, ${unfiltered} with no caller filter at all — ${inv.groups[g].split(".")[0]}`);
}

console.log("\nPending until Stage 6 (not run, no second tenant exists yet):");
console.log("  ⏳ every group A function returns disjoint rows for two different tenants");
console.log("     Until a second tenant exists this assertion passes vacuously, which is");
console.log("     worse than not running it. Stage 6 creates an empty test tenant for it.");

console.log(`\n${state.pass} passed, ${state.fail} failed`);
process.exit(state.fail ? 1 : 0);
