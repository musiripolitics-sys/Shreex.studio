/**
 * Tenants, memberships and per-tenant products — Stage 2 of the BOS Product
 * Model plan.
 *
 * What this has to prove, in order of how much it would cost to get wrong:
 *
 *  1. The backfill is complete. Every account that existed became a member
 *     carrying the role it already held. A missed row becomes an invisible
 *     row the moment Stage 4 lands.
 *  2. A tenant_id claim in the token cannot be used to enter a tenant the
 *     caller does not belong to.
 *  3. One person can belong to two tenants — the thing the old constraint
 *     shapes would have made impossible.
 *  4. Stage 2 is inert: the OS behaves exactly as it did before.
 *
 * The backfill is tested against a database stopped at 0033, seeded the way
 * production was, and then migrated. Running 0034 on an empty database would
 * prove the insert parses and nothing else.
 */
import { freshDb, applyMigration, counter } from "./_db.mjs";

const { state, ok } = counter();
const { db, skipped } = await freshDb({ upTo: "0033" });
ok(skipped.length === 0, `everything up to 0033 applied cleanly (${skipped.length} failures)`);

const q = async (s) => (await db.query(s)).rows;
const one = async (s) => (await q(s))[0];
const tryExec = async (s) => { try { await db.exec(s); return null; } catch (e) { return e.message; } };

const A = "11111111-1111-1111-1111-111111111111";  // admin
const E = "22222222-2222-2222-2222-222222222222";  // employee
const M = "33333333-3333-3333-3333-333333333333";  // community member
await db.exec(`insert into auth.users(id,email) values ('${A}','a@t.c'),('${E}','e@t.c'),('${M}','m@t.c');`);
await db.exec(`update public.users set primary_role='admin',            full_name='Ada'   where id='${A}';`);
await db.exec(`update public.users set primary_role='employee',         full_name='Priya' where id='${E}';`);
await db.exec(`update public.users set primary_role='community_member', full_name='Ravi'  where id='${M}';`);

// What the OS answered before 0034, so we can show it answers the same after.
const as = (u) => db.exec(`set role authenticated; set request.jwt.claim.sub='${u}';`);
await as(E);
await db.exec(`reset role; insert into public.employee_module_access(user_id,section) values ('${E}','plan');`);
await as(E);
const before = {
  sections: (await one(`select public.bos_my_sections() s`)).s,
  canPlan: (await one(`select public.bos_can_access('plan') c`)).c,
  canMoney: (await one(`select public.bos_can_access('money') c`)).c,
};
await db.exec(`reset role; reset request.jwt.claim.sub;`);

// ── Now run Stage 2 ──
await applyMigration(db, "0034_tenants.sql");

console.log("\nTechxfluence becomes tenant #1:");
const t = await one(`select id, slug, name, status, is_default from public.tenants`);
ok(!!t && t.slug === "techxfluence", `one tenant, slug ${t?.slug}`);
ok(t.is_default === true && t.status === "active", "it is the default and it is active");
const second = await tryExec(`insert into public.tenants(slug,name,is_default) values ('other','Other',true)`);
ok(second !== null, "a second default tenant is refused by the partial unique index");

console.log("\nEvery account that existed became a member, with the role it already held:");
const members = await q(`select u.full_name, m.role::text role, m.status
                           from public.tenant_members m join public.users u on u.id = m.user_id
                          order by u.full_name`);
ok(members.length === 3, `three members (${members.length})`);
ok(members.every((r) => r.status === "active"), "all active");
const roleOf = Object.fromEntries(members.map((r) => [r.full_name, r.role]));
ok(roleOf.Ada === "admin" && roleOf.Priya === "employee" && roleOf.Ravi === "community_member",
   `roles copied rather than flattened (${members.map((r) => `${r.full_name}=${r.role}`).join(", ")})`);
const missed = await one(`select count(*)::int c from public.users u
  where not exists (select 1 from public.tenant_members m where m.user_id = u.id)`);
ok(missed.c === 0, `no account was left out of the backfill (${missed.c} missed)`);

console.log("\nEvery product the platform has on became a product this tenant has:");
const tp = await q(`select product_key, is_enabled, settings from public.tenant_products order by product_key`);
ok(tp.length === 9, `nine rows (${tp.length})`);
ok(tp.every((r) => r.is_enabled === true), "all enabled, matching the platform catalogue");
ok(tp.every((r) => JSON.stringify(r.settings) === "{}"), "each with empty settings to configure later");

console.log("\nA new account joins without anyone remembering to add it:");
const N = "44444444-4444-4444-4444-444444444444";
await db.exec(`insert into auth.users(id,email) values ('${N}','n@t.c');`);
const joined = await one(`select m.role::text role, m.status from public.tenant_members m where m.user_id='${N}'`);
ok(!!joined, "membership was created by the trigger, not by hand");
ok(joined?.status === "active", `and is active (${joined?.status})`);

console.log("\nOne person can belong to two tenants:");
await db.exec(`insert into public.tenants(slug,name) values ('second','Second Business');`);
const t2 = (await one(`select id from public.tenants where slug='second'`)).id;
const both = await tryExec(
  `insert into public.tenant_members(tenant_id,user_id,role,status) values ('${t2}','${E}','admin','active')`);
ok(both === null, "the unique constraint includes tenant_id, so a second membership is accepted");
ok(Number((await one(`select count(*)::int c from public.tenant_members where user_id='${E}'`)).c) === 2,
   "Priya is an employee in one and an admin in the other");
const dup = await tryExec(
  `insert into public.tenant_members(tenant_id,user_id,role) values ('${t2}','${E}','member')`);
ok(dup !== null, "but not twice in the same tenant");

console.log("\nThe tenant a caller is acting in:");
await as(E);
ok((await one(`select public.bos_current_tenant() t`)).t !== null,
   "with no claim, their membership decides");
await db.exec(`set request.jwt.claim.tenant_id='${t2}';`);
ok((await one(`select public.bos_current_tenant() t`)).t === t2,
   "a claim naming a tenant they belong to is honoured");
await db.exec(`reset role; delete from public.tenant_members where tenant_id='${t2}' and user_id='${E}';`);
await as(E);
await db.exec(`set request.jwt.claim.tenant_id='${t2}';`);
ok((await one(`select public.bos_current_tenant() t`)).t === null,
   "a claim naming a tenant they do NOT belong to is refused, not trusted — the token says which, membership says whether");
await db.exec(`reset request.jwt.claim.tenant_id;`);

console.log("\nA role is a fact about a person in a tenant:");
await as(M);
ok((await one(`select public.bos_tenant_role('${t.id}')::text r`)).r === "community_member",
   "Ravi is a community member of tenant #1");
ok((await one(`select public.bos_tenant_role('${t2}') r`)).r === null,
   "and nothing at all in the second business");

console.log("\nMembership is not public reading:");
await as(M);
const seen = await q(`select user_id from public.tenant_members`);
ok(seen.length === 1 && seen[0].user_id === M,
   `a community member sees only their own membership (${seen.length} rows)`);
await as(E);
const asEmployee = await q(`select user_id from public.tenant_members`);
ok(asEmployee.length === 1,
   `an employee sees only their own too — being staff is not being a tenant admin (${asEmployee.length} rows)`);
await as(A);
ok(Number((await one(`select count(*)::int c from public.tenant_members`)).c) >= 4,
   "the admin sees them all");

console.log("\nNothing of the tenancy is readable signed out:");
await db.exec(`reset role; set role anon; reset request.jwt.claim.sub;`);
for (const tbl of ["tenants", "tenant_members", "tenant_products"]) {
  ok((await q(`select 1 from public.${tbl}`)).length === 0, `anon reads no rows from ${tbl}`);
}

console.log("\nAnd Stage 2 changed nothing about what the OS answers:");
await as(E);
const after = {
  sections: (await one(`select public.bos_my_sections() s`)).s,
  canPlan: (await one(`select public.bos_can_access('plan') c`)).c,
  canMoney: (await one(`select public.bos_can_access('money') c`)).c,
};
ok(JSON.stringify(after.sections) === JSON.stringify(before.sections),
   `bos_my_sections is unchanged (${JSON.stringify(before.sections)} -> ${JSON.stringify(after.sections)})`);
ok(after.canPlan === before.canPlan && after.canPlan === true, "a granted product is still open");
ok(after.canMoney === before.canMoney && after.canMoney === false, "an ungranted one is still shut");

console.log(`\n${state.pass} passed, ${state.fail} failed`);
process.exit(state.fail ? 1 : 0);
