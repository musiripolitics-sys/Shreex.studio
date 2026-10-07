/**
 * 0052 — a real Super Admin, and the end of authority by default tenant.
 *
 * Two things are asserted hardest. That a Super Admin reaches every business,
 * because that is the requirement. And that reaching is not seeing: the
 * restrictive isolation policies must still hold them to one business at a
 * time, or "access to all tenants" quietly becomes "all the data at once".
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
const n = (v) => Number(v);

const txf = (await one(`select id from public.tenants where is_default`)).id;
await db.exec(`insert into public.tenants(slug,name) values ('jilo','Jilo'),('txf-service','TFX Service');`);
const jilo = (await one(`select id from public.tenants where slug='jilo'`)).id;
const svc  = (await one(`select id from public.tenants where slug='txf-service'`)).id;

const SUP = "11111111-1111-1111-1111-111111111111"; // super admin
const TAD = "22222222-2222-2222-2222-222222222222"; // admin of Jilo only
const EMP = "33333333-3333-3333-3333-333333333333"; // employee of Techxfluence
await db.exec(`insert into auth.users(id,email) values
  ('${SUP}','sup@x.c'),('${TAD}','tad@x.c'),('${EMP}','emp@x.c');`);
await db.exec(`delete from public.tenant_members where user_id in ('${SUP}','${TAD}','${EMP}');`);
await db.exec(`insert into public.tenant_members(tenant_id,user_id,role,status) values
  ('${jilo}','${TAD}','admin','active'),
  ('${txf}','${EMP}','employee','active');`);
// SUP deliberately belongs to NO business, to prove the authority is not a membership.
await db.exec(`insert into public.platform_admins(user_id,role) values ('${SUP}','super_admin')
               on conflict (user_id) do update set role='super_admin', expires_at=null;`);

console.log("\nThe authority is a row, not a membership:");
await as(SUP);
ok((await one(`select public.bos_is_super_admin() v`)).v === true,
   "the super admin belongs to no business and is still a super admin");
ok((await q(`select id from public.tenant_members where user_id='${SUP}'`)).length === 0,
   "and has no tenant_members row at all");
await as(TAD);
ok((await one(`select public.bos_is_super_admin() v`)).v === false, "an admin of a business is not one");
ok((await one(`select public.bos_is_platform_owner() v`)).v === false, "nor a platform owner, which is now an alias");

console.log("\nIt survives nothing being default, which is what broke the old rule:");
await owner();
await db.exec(`update public.tenants set is_default=false;`);
await as(SUP);
ok((await one(`select public.bos_is_super_admin() v`)).v === true, "still a super admin with no default tenant");
ok(!(await tryOne(`select public.bos_platform_owner_check() v`)).e, "and may still create a business");
await owner();
await db.exec(`update public.tenants set is_default=true where id='${txf}';`);

console.log("\nA Super Admin sees every business in the switcher; an admin sees theirs:");
await as(SUP);
const mine = await q(`select slug, role from public.bos_my_tenants() order by slug`);
ok(mine.length === 3, `the super admin is offered all three (${mine.map((r) => r.slug).join(", ")})`);
ok(mine.every((r) => r.role === "super_admin"), "each marked super_admin, since none is a membership");
await as(TAD);
const theirs = await q(`select slug, role from public.bos_my_tenants()`);
ok(theirs.length === 1 && theirs[0].slug === "jilo",
   `the Jilo admin is offered only Jilo (${theirs.map((r) => r.slug).join(", ") || "none"})`);

console.log("\nEntering a business you are not a member of:");
await as(SUP);
ok(!(await tryOne(`select public.bos_switch_tenant('${jilo}') v`)).e, "the super admin enters Jilo");
ok((await one(`select public.bos_request_tenant() v`)).v === jilo, "and the request is now about Jilo");
ok((await one(`select public.is_admin() v`)).v === true, "where they are an admin");
await as(TAD);
let r = await tryOne(`select public.bos_switch_tenant('${svc}') v`);
ok(!!r.e && r.e.includes("NOT_A_MEMBER"), `the Jilo admin cannot enter TFX Service (${r.e ?? "ENTERED"})`);

console.log("\nEntering is logged, in the business that was entered:");
await owner();
const log = await one(`select tenant_id, action, entity, entity_id, user_id from public.audit_log
  where action='enter' and entity='tenants' order by created_at desc limit 1`);
ok(log?.tenant_id === jilo && log?.user_id === SUP && log?.entity_id === jilo,
   "the entry is written to Jilo own audit log, not to wherever they came from");
const before = n((await one(`select count(*) c from public.audit_log where action='enter'`)).c);
await as(TAD);
await tryOne(`select public.bos_switch_tenant('${jilo}') v`);
await owner();
ok(n((await one(`select count(*) c from public.audit_log where action='enter'`)).c) === before,
   "a member entering their own business logs nothing — only platform authority is an event");

console.log("\nReaching is not seeing. One business at a time:");
await owner();
await db.exec(`insert into public.tasks(code,title,status,tenant_id) values
  ('T-TXF','A Techxfluence task','not_started','${txf}'),
  ('T-JIL','A Jilo task','not_started','${jilo}');`);
await as(SUP);
await db.exec(`select public.bos_switch_tenant('${jilo}');`);
let seen = await q(`select code from public.tasks order by code`);
ok(seen.length === 1 && seen[0].code === "T-JIL",
   `standing in Jilo the super admin sees only the Jilo task (${seen.map((x) => x.code).join(", ")})`);
await db.exec(`select public.bos_switch_tenant('${txf}');`);
seen = await q(`select code from public.tasks order by code`);
ok(seen.length === 1 && seen[0].code === "T-TXF",
   `and standing in Techxfluence only that one (${seen.map((x) => x.code).join(", ")}) — the isolation policies still hold`);

console.log("\nAnd they cannot rewrite another business membership from inside one:");
await as(SUP);
await db.exec(`select public.bos_switch_tenant('${txf}');`);
ok((await one(`select public.bos_tenant_role('${jilo}') v`)).v === null,
   "bos_tenant_role for Jilo is null while they stand in Techxfluence");
r = await tryOne(`insert into public.tenant_members(tenant_id,user_id,role,status)
                  values ('${jilo}','${EMP}','admin','active') returning id v`);
ok(!!r.e, `so adding somebody to Jilo from inside Techxfluence is refused (${r.e ?? "INSERTED"}) — enter Jilo first, which logs`);

console.log("\nBut the tenant RECORD is platform furniture, so it needs no switch:");
await as(SUP);
await db.exec(`select public.bos_switch_tenant('${txf}');`);
ok(!(await tryOne(`select public.bos_rename_tenant('${jilo}','Jilo Holdings') v`)).e,
   "the super admin renames Jilo from the organisations page without entering it");
await owner();
ok((await one(`select name from public.tenants where id='${jilo}'`)).name === "Jilo Holdings", "and it took");
await as(TAD);
r = await tryOne(`select public.bos_rename_tenant('${svc}','Hijacked') v`);
ok(!!r.e && r.e.includes("FORBIDDEN"), `a business admin still cannot rename another business (${r.e ?? "RENAMED"})`);

console.log("\nAn expired grant is not a grant:");
await owner();
await db.exec(`update public.platform_admins set expires_at = now() - interval '1 day' where user_id='${SUP}';`);
await as(SUP);
ok((await one(`select public.bos_is_super_admin() v`)).v === false, "expired, so not a super admin");
ok((await q(`select id from public.bos_my_tenants()`)).length === 0,
   "and offered no businesses at all, because they are a member of none");
await owner();
await db.exec(`update public.platform_admins set expires_at = null where user_id='${SUP}';`);

console.log("\nThe list cannot be joined by the people on it:");
await as(TAD);
r = await tryOne(`insert into public.platform_admins(user_id,role) values ('${TAD}','super_admin') returning user_id v`);
ok(!!r.e, `a business admin cannot make themselves a super admin (${r.e ?? "INSERTED"})`);
ok((await q(`select user_id from public.platform_admins`)).length === 0,
   "and cannot even see who is one");
await as(SUP);
ok((await q(`select user_id from public.platform_admins`)).length === 1, "a super admin can");

console.log("\nWhat 0052 deliberately leaves alone:");
await owner();
const NEW = "44444444-4444-4444-4444-444444444444";
await db.exec(`insert into auth.users(id,email) values ('${NEW}','new@x.c');`);
// Asserted as it IS, not as it should end up. A new account still joins the
// default tenant, and that is correct for this migration: making
// bos_seed_tenant_membership a no-op belongs with the one that removes the
// default, because on its own it only breaks the assumption that an account
// has a business -- which the public site relies on. I had it in here and the
// Stage 3, 4 and 5 suites caught it at once.
ok(n((await one(`select count(*) c from public.tenant_members where user_id='${NEW}'`)).c) === 1,
   "a new account still joins the default tenant — moving authority is not the same as removing the default");
await as(NEW);
ok((await one(`select public.bos_request_tenant() v`)).v !== null,
   "so the public site keeps working until tenants.domain and host resolution land");
await as(NEW);
ok((await one(`select public.bos_is_super_admin() v`)).v === false,
   "and a new account is certainly not a super admin");


console.log("\nAppointing one from the product rather than from SQL:");
await as(SUP);
let g = await tryOne(`select public.bos_grant_platform_admin('tad@x.c') v`);
ok(!g.e, `the super admin appoints the Jilo admin by address (${g.e ?? "ok"})`);
await as(TAD);
ok((await one(`select public.bos_is_super_admin() v`)).v === true, "who is now a super admin");
ok((await q(`select slug from public.bos_my_tenants()`)).length === 3, "and is offered all three businesses");

await as(SUP);
g = await tryOne(`select public.bos_grant_platform_admin('nobody@nowhere.invalid') v`);
ok(!!g.e && g.e.includes("NO_SUCH_ACCOUNT"), `an address with no account is refused (${g.e ?? "GRANTED"})`);
g = await tryOne(`select public.bos_grant_platform_admin('emp@x.c','support') v`);
ok(!!g.e && g.e.includes("SUPPORT_NEEDS_EXPIRY"),
   `a support grant with no end date is refused (${g.e ?? "GRANTED"}) — that is what expires_at exists to prevent`);
g = await tryOne(`select public.bos_grant_platform_admin('emp@x.c','support', now() - interval '1 day') v`);
ok(!!g.e && g.e.includes("EXPIRY_IN_THE_PAST"), `nor one that already ended (${g.e ?? "GRANTED"})`);
ok(!(await tryOne(`select public.bos_grant_platform_admin('emp@x.c','support', now() + interval '2 days') v`)).e,
   "but a time-boxed support grant is accepted");
await as(EMP);
ok((await one(`select public.bos_is_super_admin() v`)).v === false,
   "support is not super admin — bos_is_super_admin tests the role, not mere presence in the table");

console.log("\nThe list reads only for a super admin:");
await as(SUP);
const list = await q(`select email, role, is_expired, granted_by_email, expires_at
                        from public.bos_platform_admins() order by email`);
ok(list.length === 3, `three platform administrators (${list.map((x) => `${x.email}:${x.role}`).join(", ")})`);
ok(list.find((x) => x.email === "tad@x.c")?.granted_by_email === "sup@x.c",
   `the grant records who made it (${list.find((x) => x.email === "tad@x.c")?.granted_by_email})`);
ok(list.find((x) => x.email === "emp@x.c")?.expires_at != null,
   "the support grant carries its end date");
ok(list.every((x) => x.is_expired === false), "and none of the three has lapsed");
await as(EMP);
ok((await q(`select email from public.bos_platform_admins()`)).length === 0,
   "a support grant cannot list the administrators — the where clause IS the authorisation");

console.log("\nAnd the last super admin cannot be removed:");
await as(SUP);
ok(!(await tryOne(`select public.bos_revoke_platform_admin('${TAD}') v`)).e, "one of two super admins can go");
r = await tryOne(`select public.bos_revoke_platform_admin('${SUP}') v`);
ok(!!r.e && r.e.includes("LAST_SUPER_ADMIN"),
   `the last one cannot (${r.e ?? "REVOKED"}) — nobody else may write this table, and there is no default tenant left to derive a replacement from`);
await owner();
ok(n((await one(`select count(*) c from public.platform_admins where role='super_admin'`)).c) === 1,
   "so exactly one super admin remains");

console.log(`\n${state.pass} passed, ${state.fail} failed`);
process.exit(state.fail ? 1 : 0);
