/**
 * 0050 — creating and managing organisations.
 *
 * The hole this closes was invisible from the code and obvious from the UI:
 * every piece of multi-tenancy existed except the act of making a tenant.
 * What gets asserted hardest is the lock, because bos_create_tenant is
 * SECURITY DEFINER and therefore the one place where RLS is not standing
 * behind the check — if bos_platform_owner_check is wrong, any signed-in
 * account can mint businesses.
 */
import { freshDb, counter } from "./_db.mjs";

const { state, ok } = counter();
const { db, skipped } = await freshDb();
ok(skipped.length === 0, `every migration applied cleanly (${skipped.length} failures)`);

const q = async (s) => (await db.query(s)).rows;
const one = async (s) => (await q(s))[0];
const tryOne = async (s) => { try { return { v: await one(s) }; } catch (e) { return { e: e.message.split("\n")[0] }; } };
const as = (u) => db.exec(`set role authenticated; set request.jwt.claim.sub='${u}'; set request.jwt.claim.role='authenticated'; reset request.jwt.claim.tenant_id;`);
const owner = () => db.exec(`reset role; reset request.jwt.claim.sub; reset request.jwt.claim.role; reset request.jwt.claim.tenant_id;`);

const t1 = (await one(`select id from public.tenants where is_default`)).id;

const OWN = "11111111-1111-1111-1111-111111111111"; // admin of the default tenant
const EMP = "22222222-2222-2222-2222-222222222222"; // employee of the default tenant
const OUT = "33333333-3333-3333-3333-333333333333"; // belongs to nothing
await db.exec(`insert into auth.users(id,email) values
  ('${OWN}','owner@x.c'),('${EMP}','emp@x.c'),('${OUT}','out@x.c');`);
await db.exec(`update public.users set primary_role='admin' where id='${OWN}';`);
await db.exec(`delete from public.tenant_members where user_id='${OUT}';`);
await db.exec(`update public.tenant_members set role='employee' where user_id='${EMP}';`);
await db.exec(`update public.tenant_members set role='admin', status='active' where user_id='${OWN}';`);
// Since 0052 the platform owner is a row in platform_admins, not an admin of
// the tenant that happens to be flagged default. owner has to be granted it.
await db.exec(`insert into public.platform_admins(user_id,role) values ('${OWN}','super_admin')
               on conflict (user_id) do nothing;`);

console.log("\nSlugs are derived, not trusted:");
for (const [input, want] of [
  ["Acme Widgets", "acme-widgets"],
  ["  Spaced  Out  ", "spaced-out"],
  ["Foo & Bar!!", "foo-bar"],
  ["../../etc/passwd", "etc-passwd"],
  ["ALLCAPS", "allcaps"],
  ["!!!", null],
]) {
  const got = (await one(`select public.bos_slugify('${input.replace(/'/g, "''")}') v`)).v;
  ok(got === want, `${JSON.stringify(input)} -> ${JSON.stringify(got)}`);
}

console.log("\nOnly an admin of the default business may create one:");
await as(OUT);
let r = await tryOne(`select public.bos_create_tenant('Shadow Corp') v`);
ok(!!r.e && r.e.includes("NOT_SUPER_ADMIN"), `an outsider is refused (${r.e ?? "CREATED"})`);
await as(EMP);
r = await tryOne(`select public.bos_create_tenant('Shadow Corp') v`);
ok(!!r.e && r.e.includes("NOT_SUPER_ADMIN"),
   `an employee is refused too (${r.e ?? "CREATED"}) — definer means the check is the only guard`);
await owner();
ok((await one(`select count(*) c from public.tenants`)).c === 1n ||
   Number((await one(`select count(*) c from public.tenants`)).c) === 1,
   "and nothing was written by either attempt");

console.log("\nNo direct writes to tenants, which is the whole reason the function exists:");
await as(OWN);
r = await tryOne(`insert into public.tenants(slug,name) values ('direct','Direct') returning id v`);
ok(!!r.e, `even a platform owner cannot insert a tenant row by hand (${r.e ?? "INSERTED"}) — otherwise it would be an orphan with no admin and no products`);
// UPDATE and DELETE do not raise. With no permissive policy for them the
// row is simply not visible to be written, so Postgres changes nothing and
// reports success -- which is why these assert on the ROW rather than on an
// exception. Asserting on the error was my first attempt and it passed a
// table that was wide open.
await tryOne(`update public.tenants set name='Hand Edited' where id='${t1}' returning id v`);
await tryOne(`delete from public.tenants where id='${t1}' returning id v`);
await owner();
const t1row = await one(`select name from public.tenants where id='${t1}'`);
ok(!!t1row && t1row.name !== 'Hand Edited',
   `a hand-written UPDATE changes nothing (${t1row?.name}) — RLS filters silently here, it does not raise`);
ok(!!t1row, "and a hand-written DELETE removes nothing");

console.log("\nCreating one wires up all three things or none:");
await as(OWN);
const made = await tryOne(`select public.bos_create_tenant('Acme Widgets') v`);
ok(!made.e, `the owner creates a business (${made.e ?? "ok"})`);
const t2 = made.v?.v;
await owner();
const row = await one(`select slug,name,status,is_default from public.tenants where id='${t2}'`);
ok(row?.slug === "acme-widgets", `slug derived from the name (${row?.slug})`);
ok(row?.status === "active", "it starts active");
ok(row?.is_default === false, "and it is NOT the default — there is exactly one of those");
const mem = await one(`select role,status from public.tenant_members where tenant_id='${t2}' and user_id='${OWN}'`);
ok(mem?.role === "admin" && mem?.status === "active",
   `the creator is its admin (${mem?.role}/${mem?.status}) — without this the business has no door`);
const prods = await one(`select count(*) c from public.tenant_products where tenant_id='${t2}'`);
const cat = await one(`select count(*) c from public.products`);
ok(Number(prods.c) === Number(cat.c) && Number(cat.c) > 0,
   `and it gets the whole catalogue (${prods.c} of ${cat.c})`);

console.log("\nSlugs are globally unique, and a clash says so:");
await as(OWN);
r = await tryOne(`select public.bos_create_tenant('Acme   Widgets') v`);
ok(!!r.e && r.e.includes("SLUG_TAKEN"), `a second Acme is refused (${r.e ?? "CREATED"})`);
r = await tryOne(`select public.bos_create_tenant('Acme Widgets','acme-two') v`);
ok(!r.e, "but an explicit slug gets round it");
r = await tryOne(`select public.bos_create_tenant('x') v`);
ok(!!r.e && r.e.includes("BAD_NAME"), `a one-character name is refused (${r.e ?? "CREATED"})`);
r = await tryOne(`select public.bos_create_tenant('!!!') v`);
ok(!!r.e && (r.e.includes("BAD_SLUG") || r.e.includes("BAD_NAME")),
   `a name with no usable characters is refused (${r.e ?? "CREATED"})`);

console.log("\nThe new business is isolated from the first one from the moment it exists:");
await as(OWN);
await db.exec(`select public.bos_switch_tenant('${t2}');`);
ok((await one(`select public.bos_request_tenant() v`)).v === t2, "the owner switches into Acme");
const seen = await one(`select count(*) c from public.tasks`);
await db.exec(`select public.bos_switch_tenant('${t1}');`);
ok(Number(seen.c) === 0, `and sees none of the first business work (${seen.c} tasks)`);

console.log("\nRenaming is admin of THAT business, not of the request:");
await as(OWN);
await db.exec(`select public.bos_switch_tenant('${t1}');`);
r = await tryOne(`select public.bos_rename_tenant('${t2}','Acme Holdings') v`);
ok(!r.e, `the owner renames Acme while standing in the first business (${r.e ?? "ok"}) — managing one must not require switching into it`);
await owner();
const after = await one(`select name,slug from public.tenants where id='${t2}'`);
ok(after.name === "Acme Holdings", `the name changed (${after.name})`);
ok(after.slug === "acme-widgets", "and the slug did not, because it is an address");
await as(EMP);
r = await tryOne(`select public.bos_rename_tenant('${t1}','Hijacked') v`);
ok(!!r.e && r.e.includes("FORBIDDEN"), `an employee cannot rename their own business (${r.e ?? "RENAMED"})`);

console.log("\nStatus, and the one tenant that may never leave the active set:");
await as(OWN);
r = await tryOne(`select public.bos_set_tenant_status('${t1}','suspended') v`);
ok(!!r.e && r.e.includes("CANNOT_SUSPEND_DEFAULT"),
   `the default business cannot be suspended (${r.e ?? "SUSPENDED"}) — bos_request_tenant falls back to it`);
r = await tryOne(`select public.bos_set_tenant_status('${t2}','nonsense') v`);
ok(!!r.e && r.e.includes("BAD_STATUS"), `an unknown status is refused (${r.e ?? "SET"})`);

await owner();
await db.exec(`update public.users set active_tenant_id='${t2}' where id='${OWN}';`);
await as(OWN);
await tryOne(`select public.bos_set_tenant_status('${t2}','suspended') v`);
await owner();
ok((await one(`select status from public.tenants where id='${t2}'`)).status === "suspended", "Acme suspends");
ok((await one(`select active_tenant_id from public.users where id='${OWN}'`)).active_tenant_id === null,
   "and whoever was standing in it is sent back to the default, rather than stranded somewhere bos_my_tenants will not list");

console.log("\nA suspended business disappears from switching but not from management:");
await as(OWN);
ok(!(await q(`select id from public.bos_my_tenants()`)).some((x) => x.id === t2),
   "bos_my_tenants hides it, so the switcher will not offer a business nobody can enter");
const sum = await q(`select id,status,member_count,product_count from public.bos_my_tenant_summary()`);
const acme = sum.find((x) => x.id === t2);
ok(!!acme && acme.status === "suspended",
   "bos_my_tenant_summary still shows it, because a page for managing businesses has to show the one you suspended");
ok(Number(acme.member_count) === 1 && Number(acme.product_count) > 0,
   `with its counts (${acme?.member_count} members, ${acme?.product_count} products)`);
r = await tryOne(`select public.bos_set_tenant_status('${t2}','active') v`);
ok(!r.e, `and it can be brought back (${r.e ?? "ok"})`);

console.log("\nThe summary does not leak businesses you do not belong to:");
await as(EMP);
const empSum = await q(`select id from public.bos_my_tenant_summary()`);
ok(empSum.length === 1 && empSum[0].id === t1,
   `an employee of the first business sees only it (${empSum.length} rows) — definer, so this filter is the only thing stopping a full list`);
await as(OUT);
ok((await q(`select id from public.bos_my_tenant_summary()`)).length === 0, "an outsider sees nothing");

console.log("\nNothing is reachable without being signed in:");
// Execute is revoked from anon by the migration. The fixture replays a
// blanket "grant execute on all functions to anon, authenticated" after
// every migration, so the ACL here is the fixture speaking, not the
// repository -- which is exactly why this asserts the RUNTIME refusal
// instead. The grant is defence in depth; the auth.uid() check is the lock.
await db.exec(`set role anon; set request.jwt.claim.role='anon'; reset request.jwt.claim.sub;`);
for (const [label, sql] of [
  ["bos_create_tenant",     `select public.bos_create_tenant('Anon Corp') v`],
  ["bos_rename_tenant",     `select public.bos_rename_tenant('${t1}','Anon') v`],
  ["bos_set_tenant_status", `select public.bos_set_tenant_status('${t1}','suspended') v`],
]) {
  const a = await tryOne(sql);
  ok(!!a.e, `anon calling ${label} is refused (${a.e ?? "SUCCEEDED"})`);
}
ok((await q(`select id from public.bos_my_tenant_summary()`)).length === 0,
   "and bos_my_tenant_summary returns nothing to an anonymous caller");
await owner();
for (const fn of ["bos_create_tenant", "bos_rename_tenant", "bos_set_tenant_status",
                  "bos_my_tenant_summary", "bos_is_platform_owner", "bos_platform_owner_check"]) {
  const g = await one(`select p.proacl::text acl
                         from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                        where n.nspname='public' and p.proname='${fn}' limit 1`);
  ok(!!g && !/(^|,)=X/.test(g.acl ?? ""), `${fn}: EXECUTE not granted to PUBLIC`);
}

await owner();
console.log(`\n${state.pass}/${state.pass + state.fail} assertions passed`);
process.exit(state.fail ? 1 : 0);
