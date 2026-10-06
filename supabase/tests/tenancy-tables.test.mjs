/**
 * Guard: no table reaches production unclassified.
 *
 * Stage 0 of the BOS Product Model plan. This runs BEFORE any tenancy exists,
 * on purpose. The single most likely way to leak one tenant's data into
 * another is for a table to ship without a tenant policy, and the only
 * control that survives contact with a growing codebase is one that reads the
 * catalogue rather than a list somebody remembers to update.
 *
 * So: the tables come from pg_class, the classification comes from
 * supabase/tenancy/tables.json, and a table in one but not the other fails.
 * A new table ships failing until somebody says what it is.
 */
import fs from "fs";
import { freshDb, counter } from "./_db.mjs";

const manifest = JSON.parse(fs.readFileSync("supabase/tenancy/tables.json", "utf8"));
const { db, skipped } = await freshDb();
const { state, ok } = counter();
const q = async (s) => (await db.query(s)).rows;

ok(skipped.length === 0, `every migration applied cleanly (${skipped.length} failures)`);

const tables = await q(`
  select c.relname as name,
         c.relrowsecurity as rls,
         c.relforcerowsecurity as forced,
         (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
   order by c.relname`);

const classified = new Set([
  ...manifest.tenant,
  ...Object.keys(manifest.identity),
  ...Object.keys(manifest.platform),
  ...Object.keys(manifest.tenancy ?? {}),
]);

console.log("\nEvery table is classified tenant, tenancy, identity or platform:");
const unclassified = tables.filter((t) => !classified.has(t.name)).map((t) => t.name);
ok(unclassified.length === 0,
   unclassified.length === 0
     ? `all ${tables.length} tables appear in supabase/tenancy/tables.json`
     : `UNCLASSIFIED: ${unclassified.join(", ")} — add each to tenant, tenancy, identity or platform in supabase/tenancy/tables.json`);

const live = new Set(tables.map((t) => t.name));
const stale = [...classified].filter((n) => !live.has(n));
ok(stale.length === 0,
   stale.length === 0
     ? "and nothing is classified that no longer exists"
     : `STALE: ${stale.join(", ")} — remove from supabase/tenancy/tables.json`);

console.log("\nEvery table has row level security and something to enforce:");
const noRls = tables.filter((t) => !t.rls).map((t) => t.name);
ok(noRls.length === 0,
   noRls.length === 0 ? `RLS enabled on all ${tables.length}` : `RLS OFF: ${noRls.join(", ")}`);

const noPolicy = tables.filter((t) => t.policies === 0).map((t) => t.name);
ok(noPolicy.length === 0,
   noPolicy.length === 0
     ? "and every one carries at least one policy"
     : `NO POLICY: ${noPolicy.join(", ")} — RLS with no policy denies everyone, which is safe but almost never intended`);

console.log("\nFORCE ROW LEVEL SECURITY only ever goes up:");
const forced = tables.filter((t) => t.forced).length;
ok(forced >= manifest.forceRlsBaseline,
   `${forced} of ${tables.length} tables force RLS (baseline ${manifest.forceRlsBaseline})`);
if (forced > manifest.forceRlsBaseline) {
  console.log(`  ↑  raise forceRlsBaseline in supabase/tenancy/tables.json to ${forced}`);
}

console.log("\nEvery unique constraint on a tenant-owned table is accounted for:");
const uc = manifest.uniqueConstraints;
const known = new Set([...Object.keys(uc.needsTenantId), ...Object.keys(uc.alreadySafe)]);
// The tenancy tables are checked too: tenant_products(tenant_id, product_key)
// is exactly the shape worth recording, and skipping them would leave a hole
// in the one guard whose job is to find colliding constraints.
const tenantTables = new Set([...manifest.tenant, ...Object.keys(manifest.tenancy ?? {})]);
const live_uc = (await q(`
  select c.relname as t, con.conname,
         (select string_agg(a.attname, ',' order by a.attnum)
            from pg_attribute a
           where a.attrelid = c.oid and a.attnum = any(con.conkey)) as cols
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and con.contype = 'u'
   order by c.relname, con.conname`))
  .filter((r) => tenantTables.has(r.t))
  .map((r) => `${r.t}(${r.cols})`);

const newUc = live_uc.filter((s) => !known.has(s));
ok(newUc.length === 0,
   newUc.length === 0
     ? `all ${live_uc.length} across the tenant and tenancy tables classified (${Object.keys(uc.needsTenantId).length} need tenant_id in Stage 3, ${Object.keys(uc.alreadySafe).length} already safe)`
     : `UNCLASSIFIED CONSTRAINT: ${newUc.join(", ")} — a unique constraint that does not include the tenant makes two tenants collide; classify it in supabase/tenancy/tables.json`);

const staleUc = [...known].filter((s) => !live_uc.includes(s));
ok(staleUc.length === 0,
   staleUc.length === 0 ? "and none is listed that no longer exists" : `STALE CONSTRAINT: ${staleUc.join(", ")}`);

console.log(`\n${state.pass} passed, ${state.fail} failed`);
process.exit(state.fail ? 1 : 0);
