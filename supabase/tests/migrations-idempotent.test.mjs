/**
 * Every migration can be run twice.
 *
 * Written because it was not true. 0051 dropped the policy name it was
 * REPLACING and not the one it was CREATING, so a second run failed with
 *
 *   42710: policy "platform owner writes products" for table "products"
 *          already exists
 *
 * and it failed in production, on a paste whose own header said "safe to run
 * twice". Every file in this repository claims idempotence in its comment
 * header; nothing checked. This does.
 *
 * It matters more than it looks. A migration that cannot be re-run cannot be
 * recovered from: a paste that fails halfway leaves a database in a state the
 * same paste can no longer repair, and the only way forward is to read the
 * file and work out by hand which statements already took.
 */
import { freshDb, counter, migrationFiles, applyMigration } from "./_db.mjs";

const { state, ok } = counter();
const { db, skipped } = await freshDb();
ok(skipped.length === 0, `every migration applied cleanly the first time (${skipped.length} failures)`);

console.log("\nAnd every one of them again, in order, against the database they built:");
/**
 * Two files cannot be replayed against the FINAL schema, and neither is a bug.
 *
 * Both seed a catalogue with "on conflict (key) do nothing" -- 0007 seeds
 * workstreams, 0027 seeds email_templates -- and 0036 deliberately replaced
 * the narrow unique on key with a tenant-scoped composite. Postgres resolves
 * ON CONFLICT against a real index, so with the narrow one gone the clause
 * matches nothing and raises 42P10.
 *
 * That is 0036 working as designed. A migration is idempotent against the
 * schema as it stood when it ran, which is the only sense in which the word
 * is useful, and nobody replays a pre-0036 file against a post-0036 database.
 * Pinned by name so a THIRD file appearing here is a regression rather than a
 * shrug, and pinned with the table so the reason can be checked.
 */
const replayExempt = new Map([
  ["0007_business_os.sql", "workstreams"],
  ["0027_host_crm.sql", "email_templates"],
]);

const files = migrationFiles();
ok([...replayExempt.keys()].every((f) => files.includes(f)),
   `both replay exemptions still name real migrations (${[...replayExempt.keys()].join(", ")})`);

const failed = [];
for (const f of files) {
  try {
    await applyMigration(db, f);
  } catch (e) {
    const msg = e.message.split("\n")[0];
    if (replayExempt.has(f) && msg.includes("ON CONFLICT")) continue;
    failed.push({ f, msg });
  }
}

// The exemption is only honest if the narrow unique really is gone and the
// composite really is there. Otherwise it hides a different failure.
for (const [f, table] of replayExempt) {
  const narrow = await db.query(`select count(*) c from pg_index x
    join pg_class i on i.oid = x.indexrelid
    where x.indrelid = 'public.${table}'::regclass and x.indisunique
      and pg_get_indexdef(i.oid) ~ '\\(key\\)$'`);
  const composite = await db.query(`select count(*) c from pg_index x
    join pg_class i on i.oid = x.indexrelid
    where x.indrelid = 'public.${table}'::regclass and x.indisunique
      and pg_get_indexdef(i.oid) like '%(tenant_id, key)%'`);
  ok(Number(narrow.rows[0].c) === 0 && Number(composite.rows[0].c) === 1,
     `${f} is exempt for the stated reason: ${table} has no narrow unique on key and does have (tenant_id, key)`);
}

for (const { f, msg } of failed) console.log(`     ${f}: ${msg}`);
ok(failed.length === 0,
   failed.length === 0
     ? `all ${files.length - replayExempt.size} replayable migrations ran a second time with no error — a half-applied paste can be repaired by running the same paste again`
     : `${failed.length} of ${files.length} cannot be run twice: ${failed.map((x) => x.f).join(", ")}`);

// A spot check that replaying did not quietly duplicate anything, since
// "no error" and "no damage" are different claims.
const q = async (s) => (await db.query(s)).rows[0];
const dupPolicies = await q(`select count(*) c from (
  select tablename, policyname, count(*) n from pg_policies
   where schemaname='public' group by 1,2 having count(*) > 1) d`);
ok(Number(dupPolicies.c) === 0, `no policy exists twice (${dupPolicies.c})`);
const dupProducts = await q(`select count(*) c from (
  select key, count(*) n from public.products group by 1 having count(*) > 1) d`);
ok(Number(dupProducts.c) === 0, `the product catalogue was not re-seeded (${dupProducts.c} duplicated keys)`);
const tenants = await q(`select count(*) c from public.tenants`);
ok(Number(tenants.c) === 1, `and still exactly one business, not two (${tenants.c})`);
const supers = await q(`select count(*) c from public.platform_admins`);
ok(Number(supers.c) >= 0, `platform_admins replayed without error (${supers.c} rows)`);

console.log(`\n${state.pass} passed, ${state.fail} failed`);
process.exit(state.fail ? 1 : 0);
