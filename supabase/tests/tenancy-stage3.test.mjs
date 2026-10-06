/**
 * tenant_id everywhere — Stage 3 of the BOS Product Model plan.
 *
 * The failure modes this has to rule out, in order of how badly they end:
 *
 *  1. Every insert in the application starts violating a not-null. There are
 *     hundreds of insert paths across 87 tables and not one passes a tenant,
 *     so the column default is the only thing between this migration and an
 *     outage. Tested as an authenticated user AND as the service role, which
 *     has no auth.uid() and so no membership to derive a tenant from.
 *  2. A table is missed. Its rows become invisible the moment Stage 4 lands,
 *     so the table list is asserted against the manifest rather than trusted.
 *  3. A table that must NOT have a tenant gets one.
 *  4. The backfill leaves nulls behind.
 *  5. Deleting a tenant quietly deletes a business.
 */
import fs from "fs";
import { freshDb, applyMigration, counter } from "./_db.mjs";

const { state, ok } = counter();
const manifest = JSON.parse(fs.readFileSync("supabase/tenancy/tables.json", "utf8"));
const sql = fs.readFileSync("supabase/migrations/0035_tenant_id.sql", "utf8");

console.log("\nThe migration list cannot drift from the manifest:");
const arr = sql.match(/v_tables text\[\] := array\[([\s\S]*?)\];/);
const inSql = [...(arr?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
const inManifest = [...manifest.tenant].sort();
ok(inSql.length === inManifest.length && inSql.every((t, i) => t === inManifest[i]),
   inSql.length === inManifest.length && inSql.every((t, i) => t === inManifest[i])
     ? `the ${inSql.length} tables in 0035 are exactly the tenant bucket of tables.json`
     : `DRIFT — only in 0035: ${inSql.filter((t) => !inManifest.includes(t)).join(", ") || "none"}; only in the manifest: ${inManifest.filter((t) => !inSql.includes(t)).join(", ") || "none"}`);

// ── A database stopped before Stage 3, with rows in it, then migrated ──
const { db, skipped } = await freshDb({ upTo: "0034" });
ok(skipped.length === 0, `everything up to 0034 applied cleanly (${skipped.length} failures)`);
const q = async (s) => (await db.query(s)).rows;
const one = async (s) => (await q(s))[0];
const tryExec = async (s) => { try { await db.exec(s); return null; } catch (e) { return e.message; } };

const A = "11111111-1111-1111-1111-111111111111";
const E = "22222222-2222-2222-2222-222222222222";
await db.exec(`insert into auth.users(id,email) values ('${A}','a@t.c'),('${E}','e@t.c');`);
await db.exec(`update public.users set primary_role='admin',    full_name='Ada'   where id='${A}';`);
await db.exec(`update public.users set primary_role='employee', full_name='Priya' where id='${E}';`);
await db.exec(`insert into public.employee_module_access(user_id,section) values ('${E}','plan');`);
await db.exec(`insert into public.workstreams(key,name) values ('delivery','Delivery');`);
await db.exec(`insert into public.risks(code,risk,area,owner_id,impact,likelihood,next_review)
               values ('R-01','Venue cancels','Events','${A}',4,3,current_date);`);

const as = (u) => db.exec(`set role authenticated; set request.jwt.claim.sub='${u}';`);
await as(E);
const before = {
  sections: (await one(`select public.bos_my_sections() s`)).s,
  canPlan: (await one(`select public.bos_can_access('plan') c`)).c,
};
await db.exec(`reset role; reset request.jwt.claim.sub;`);

await applyMigration(db, "0035_tenant_id.sql");

const tenant = (await one(`select id from public.tenants where is_default`)).id;
const cols = await q(`
  select c.relname as t, a.attnotnull as nn, pg_get_expr(d.adbin, d.adrelid) as def
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and a.attnum > 0
    left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
   where n.nspname = 'public' and c.relkind = 'r'`);
const byTable = new Map(cols.map((r) => [r.t, r]));

console.log("\nEvery tenant-owned table carries the tenant:");
const absent = manifest.tenant.filter((t) => !byTable.has(t));
ok(absent.length === 0, absent.length === 0 ? `all ${manifest.tenant.length} have tenant_id` : `MISSING: ${absent.join(", ")}`);
const nullable = manifest.tenant.filter((t) => !byTable.get(t)?.nn);
ok(nullable.length === 0, nullable.length === 0 ? "not null on every one" : `NULLABLE: ${nullable.join(", ")}`);
const undefaulted = manifest.tenant.filter((t) => !/bos_tenant_default/.test(byTable.get(t)?.def ?? ""));
ok(undefaulted.length === 0,
   undefaulted.length === 0
     ? "and each defaults to bos_tenant_default(), which is what keeps existing inserts working"
     : `NO DEFAULT: ${undefaulted.join(", ")}`);

console.log("\nAnd nothing else does:");
const mustNot = [...Object.keys(manifest.identity), ...Object.keys(manifest.platform)];
const wrongly = mustNot.filter((t) => byTable.has(t));
ok(wrongly.length === 0,
   wrongly.length === 0
     ? `users, user_roles, products, rate_limits and email_failures have no tenant_id`
     : `WRONGLY SCOPED: ${wrongly.join(", ")} — putting tenant_id on users would force a separate account per business`);

console.log("\nThe backfill reached the rows that were already there:");
ok((await one(`select tenant_id from public.workstreams`)).tenant_id === tenant, "a workstream written before the migration belongs to tenant #1");
ok((await one(`select tenant_id from public.risks`)).tenant_id === tenant, "so does a risk");
ok((await one(`select tenant_id from public.employee_module_access`)).tenant_id === tenant, "so does a grant");
let nulls = 0;
for (const t of manifest.tenant) {
  nulls += Number((await one(`select count(*)::int c from public.${t} where tenant_id is null`)).c);
}
ok(nulls === 0, `no row anywhere was left without a tenant (${nulls} nulls across ${manifest.tenant.length} tables)`);

console.log("\nAn insert that knows nothing about tenants still works:");
await as(A);
const asUser = await tryExec(`insert into public.workstreams(key,name) values ('growth','Growth')`);
ok(asUser === null, `as a signed-in admin (${asUser ?? "accepted"})`);
ok((await one(`select tenant_id from public.workstreams where key='growth'`)).tenant_id === tenant,
   "and the row lands in their tenant");
await db.exec(`reset role; reset request.jwt.claim.sub;`);
const asService = await tryExec(`insert into public.cities(name) values ('Chennai')`);
ok(asService === null, `as the service role, which has no auth.uid() at all (${asService ?? "accepted"})`);
ok((await one(`select tenant_id from public.cities where name='Chennai'`)).tenant_id === tenant,
   "and falls back to the default tenant rather than null — this is the cron job, the payment webhook and employee onboarding");

console.log("\nDeleting a tenant cannot quietly delete a business:");
// Counted rather than guessed: schema.sql seeds twelve workstreams, so a
// hard-coded number here would be asserting the seed rather than the delete.
const rowsBefore = Number((await one(`select count(*)::int c from public.workstreams`)).c);
const del = await tryExec(`delete from public.tenants where id='${tenant}'`);
ok(del !== null && /foreign key|violates/i.test(del ?? ""),
   "the delete is refused, because the foreign keys are ON DELETE RESTRICT rather than CASCADE");
const rowsAfter = Number((await one(`select count(*)::int c from public.workstreams`)).c);
ok(rowsAfter === rowsBefore && rowsBefore > 0,
   `and not one row went with it (${rowsBefore} before, ${rowsAfter} after)`);

console.log("\nThe 21 colliding constraints now have a composite beside them:");
const uniques = await q(`
  select t.relname tbl, i.relname idx,
         (select string_agg(a.attname, ',' order by k.ord)
            from unnest(ix.indkey) with ordinality k(attnum, ord)
            join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum) cols
    from pg_index ix join pg_class i on i.oid = ix.indexrelid
    join pg_class t on t.oid = ix.indrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname='public' and ix.indisunique and not ix.indisprimary and ix.indpred is null`);
const have = new Set(uniques.map((r) => `${r.tbl}(${r.cols})`));
// scopedIn0036 is keyed by the NARROW form, which is exactly what this
// database still has: it stops at 0035, where both forms coexist.
const needed = Object.keys(manifest.uniqueConstraints.scopedIn0036);
const missingComposite = needed.filter((k) => {
  const m = k.match(/^(\w+)\((.+)\)$/);
  return !have.has(`${m[1]}(tenant_id,${m[2]})`);
});
ok(missingComposite.length === 0,
   missingComposite.length === 0
     ? `all ${needed.length} composites created`
     : `MISSING COMPOSITE: ${missingComposite.join(", ")}`);

console.log("\nAnd the narrow ones are deliberately still there:");
const narrowStill = needed.filter((k) => have.has(k));
ok(narrowStill.length === needed.length,
   `all ${narrowStill.length} kept, so the four application upserts that name those columns keep working until 0036`);
const clash = await tryExec(
  `insert into public.workstreams(key,name,tenant_id) values ('delivery','Delivery Two','${tenant}')`);
ok(clash !== null, "which also means two tenants still cannot share a workstream key — that is what 0036 fixes");

console.log("\nStage 3 changed nothing about what the OS answers:");
await as(E);
ok(JSON.stringify((await one(`select public.bos_my_sections() s`)).s) === JSON.stringify(before.sections),
   `bos_my_sections is unchanged (${JSON.stringify(before.sections)})`);
ok((await one(`select public.bos_can_access('plan') c`)).c === before.canPlan, "and so is bos_can_access");

console.log(`\n${state.pass} passed, ${state.fail} failed`);
process.exit(state.fail ? 1 : 0);
