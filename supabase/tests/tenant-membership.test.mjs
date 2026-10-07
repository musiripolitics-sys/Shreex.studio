/**
 * 0051 — the rest of the is_admin() short-circuit, and the flows that
 * creating a business implies.
 *
 * The first block is the one that matters. Before this migration an admin of
 * any business could make themselves admin of any other and delete its real
 * admin, because the write policy on tenant_members tested is_admin(), which
 * since 0047 is about the request rather than the row. It was unreachable
 * only because there was no way to create a second business — and 0050 is
 * exactly that way, so these two migrations have to land together.
 */
import { freshDb, counter } from "./_db.mjs";

const { state, ok } = counter();
const { db, skipped } = await freshDb();
ok(skipped.length === 0, `every migration applied cleanly (${skipped.length} failures)`);

const q = async (s) => (await db.query(s)).rows;
const one = async (s) => (await q(s))[0];
const tryOne = async (s) => { try { return { v: await one(s) }; } catch (e) { return { e: e.message.split("\n")[0] }; } };
const as = (u) => db.exec(`set role authenticated; set request.jwt.claim.sub='${u}'; set request.jwt.claim.role='authenticated'; reset request.jwt.claim.tenant_id;`);
const asIn = (u, t) => db.exec(`set role authenticated; set request.jwt.claim.sub='${u}'; set request.jwt.claim.role='authenticated'; set request.jwt.claim.tenant_id='${t}';`);
const owner = () => db.exec(`reset role; reset request.jwt.claim.sub; reset request.jwt.claim.role; reset request.jwt.claim.tenant_id;`);

const t1 = (await one(`select id from public.tenants where is_default`)).id;
await db.exec(`insert into public.tenants(slug,name) values ('two','Business Two');`);
const t2 = (await one(`select id from public.tenants where slug='two'`)).id;
await db.exec(`insert into public.tenant_products(tenant_id,product_key,is_enabled)
  select '${t2}', key, is_enabled from public.products on conflict do nothing;`);

const ADA = "11111111-1111-1111-1111-111111111111"; // admin of Business One
const BEN = "22222222-2222-2222-2222-222222222222"; // admin of Business Two
const CAL = "33333333-3333-3333-3333-333333333333"; // employee of Business Two
const DEE = "44444444-4444-4444-4444-444444444444"; // second admin of Business Two
await db.exec(`insert into auth.users(id,email) values
  ('${ADA}','ada@x.c'),('${BEN}','ben@x.c'),('${CAL}','cal@x.c'),('${DEE}','dee@x.c');`);
await db.exec(`delete from public.tenant_members where user_id in ('${ADA}','${BEN}','${CAL}','${DEE}');`);
await db.exec(`insert into public.tenant_members(tenant_id,user_id,role,status) values
  ('${t1}','${ADA}','admin','active'),
  ('${t2}','${BEN}','admin','active'),
  ('${t2}','${CAL}','employee','active'),
  ('${t2}','${DEE}','admin','active');`);
// Since 0052 the platform owner is a row in platform_admins, not an admin of
// the tenant that happens to be flagged default. Ada has to be granted it.
await db.exec(`insert into public.platform_admins(user_id,role) values ('${ADA}','super_admin')
               on conflict (user_id) do nothing;`);

console.log("\nAn admin of one business cannot touch another — the takeover this closes:");
await asIn(BEN, t2);
let r = await tryOne(`insert into public.tenant_members(tenant_id,user_id,role,status)
                     values ('${t1}','${BEN}','admin','active') returning id v`);
ok(!!r.e, `Ben cannot insert himself into Business One as admin (${r.e ?? "INSERTED"})`);
await tryOne(`delete from public.tenant_members where tenant_id='${t1}' and user_id='${ADA}'`);
await tryOne(`update public.tenant_products set is_enabled=false where tenant_id='${t1}'`);
const roster = await q(`select user_id from public.tenant_members where tenant_id='${t1}'`);
ok(roster.length === 0, `nor read the Business One roster (${roster.length} rows visible)`);
await owner();
ok(Number((await one(`select count(*) c from public.tenant_members where tenant_id='${t1}' and user_id='${ADA}'`)).c) === 1,
   "Ada is still an admin of her own business");
ok(Number((await one(`select count(*) c from public.tenant_products where tenant_id='${t1}' and is_enabled=false`)).c) === 0,
   "and none of her products were switched off");

console.log("\nThe catalogue is platform furniture, not a business possession:");
await asIn(BEN, t2);
await tryOne(`update public.products set is_enabled=false where key='events'`);
await owner();
ok((await one(`select is_enabled from public.products where key='events'`)).is_enabled === true,
   "an admin of a business cannot disable a product for every business");
await as(ADA);
ok((await one(`select public.bos_is_platform_owner() v`)).v === true, "Ada, admin of the default business, is the platform owner");
r = await tryOne(`update public.products set name='Gatherings' where key='events' returning key v`);
await owner();
ok((await one(`select name from public.products where key='events'`)).name === "Gatherings",
   "and she can rename one, because the catalogue is hers");
await db.exec(`update public.products set name='Events' where key='events';`);

console.log("\nA product switched off for one business is off in that business only:");
await asIn(BEN, t2);
ok(!(await tryOne(`select public.bos_set_tenant_product('events', false) v`)).e, "Ben switches events off in Business Two");
ok((await one(`select public.bos_product_enabled('events') v`)).v === false, "it is off for him");
ok((await q(`select unnest(public.bos_my_sections()) k`)).every((x) => x.k !== "events"),
   "gone from his nav");
ok((await one(`select public.bos_can_access('events') v`)).v === false,
   "and bos_can_access refuses it — an admin too, which is what makes the switch mean something");
await asIn(ADA, t1);
ok((await one(`select public.bos_product_enabled('events') v`)).v === true, "still on in Business One");
ok((await q(`select unnest(public.bos_my_sections()) k`)).some((x) => x.k === "events"), "and still in Ada nav");

console.log("\nAbsence of a row defers to the catalogue rather than meaning off:");
await owner();
await db.exec(`insert into public.products(key,name,surface,sort_order,is_enabled)
               values ('brandnew','Brand New','os',999,true) on conflict (key) do nothing;`);
await asIn(BEN, t2);
ok((await one(`select public.bos_product_enabled('brandnew') v`)).v === true,
   "a product added after the business existed appears, because it has no row to say otherwise");
const summary = await q(`select key, tenant_enabled, has_row from public.bos_tenant_products() where key in ('brandnew','events')`);
ok(summary.find((x) => x.key === "brandnew")?.has_row === false,
   "and the UI can tell that from a decision: has_row is false");
ok(summary.find((x) => x.key === "events")?.has_row === true,
   "while the product he switched off has a row");
ok((await one(`select public.bos_product_enabled('no-such-product') v`)).v === false,
   "an unknown key is refused rather than allowed");

console.log("\nRoles change, and the last admin cannot be removed:");
await asIn(BEN, t2);
ok(!(await tryOne(`select public.bos_set_member_role('${CAL}','admin') v`)).e, "Ben promotes Cal to admin");
await owner();
ok((await one(`select role from public.tenant_members where tenant_id='${t2}' and user_id='${CAL}'`)).role === "admin", "and it took");
await asIn(CAL, t2);
r = await tryOne(`select public.bos_set_member_role('${ADA}','employee') v`);
ok(!!r.e && r.e.includes("NOT_A_MEMBER"),
   `Cal cannot change a role in a business Ada belongs to and he does not (${r.e ?? "CHANGED"})`);

// Down to one admin, then try to remove them.
await asIn(BEN, t2);
await tryOne(`select public.bos_set_member_role('${CAL}','employee') v`);
await tryOne(`select public.bos_remove_member('${DEE}') v`);
await owner();
const admins = Number((await one(`select count(*) c from public.tenant_members
  where tenant_id='${t2}' and role='admin' and status='active'`)).c);
ok(admins === 1, `Business Two is down to one admin (${admins})`);
await asIn(BEN, t2);
r = await tryOne(`select public.bos_remove_member('${BEN}') v`);
ok(!!r.e && r.e.includes("LAST_ADMIN"), `the last admin cannot remove himself (${r.e ?? "REMOVED"})`);
r = await tryOne(`select public.bos_set_member_role('${BEN}','employee') v`);
ok(!!r.e && r.e.includes("LAST_ADMIN"),
   `nor demote himself (${r.e ?? "DEMOTED"}) — only an admin may appoint one, so a business with none needs the service role to recover`);

console.log("\nRemoving somebody takes their grants in THIS business and no other:");
await owner();
await db.exec(`insert into public.tenant_members(tenant_id,user_id,role,status)
               values ('${t1}','${CAL}','employee','active') on conflict (tenant_id,user_id) do update set status='active';`);
await db.exec(`insert into public.employee_module_access(user_id,section,tenant_id) values
  ('${CAL}','plan','${t1}'), ('${CAL}','plan','${t2}') on conflict do nothing;`);
await db.exec(`update public.users set active_tenant_id='${t2}' where id='${CAL}';`);
await asIn(BEN, t2);
ok(!(await tryOne(`select public.bos_remove_member('${CAL}') v`)).e, "Ben removes Cal from Business Two");
await owner();
ok((await one(`select status from public.tenant_members where tenant_id='${t2}' and user_id='${CAL}'`)).status === "ended",
   "the membership is ended, not deleted, so every row he wrote stays readable");
ok(Number((await one(`select count(*) c from public.employee_module_access where user_id='${CAL}' and tenant_id='${t2}'`)).c) === 0,
   "his grants in Business Two are gone");
ok(Number((await one(`select count(*) c from public.employee_module_access where user_id='${CAL}' and tenant_id='${t1}'`)).c) === 1,
   "his grant in Business One is untouched — that is not Business Two to revoke");
ok((await one(`select active_tenant_id from public.users where id='${CAL}'`)).active_tenant_id === null,
   "and he is no longer standing in a business he is not in");
await as(CAL);
ok(!(await q(`select id from public.bos_my_tenants()`)).some((x) => x.id === t2),
   "Business Two has disappeared from his switcher");

console.log(`\n${state.pass} passed, ${state.fail} failed`);
process.exit(state.fail ? 1 : 0);
