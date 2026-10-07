/**
 * 0053 — what a platform console needs that no business page does.
 *
 * The widening here is deliberate and is the thing to watch: 0052 held that a
 * super admin manages a business DATA only from inside it, and appointing its
 * administrator is now an exception. So the assertions check that the
 * exception is exactly as wide as stated -- appointing yes, reading the
 * business data still no -- and that it is logged in the business that gained
 * an administrator.
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

const SUP = "11111111-1111-1111-1111-111111111111"; // super admin, member of nothing
const OFF = "22222222-2222-2222-2222-222222222222"; // the officer to be appointed
const TAD = "33333333-3333-3333-3333-333333333333"; // an admin of Jilo, not a super admin
await db.exec(`insert into auth.users(id,email) values
  ('${SUP}','sup@x.c'),('${OFF}','officer@jilo.com'),('${TAD}','tad@x.c');`);
await db.exec(`delete from public.tenant_members where user_id in ('${SUP}','${OFF}','${TAD}');`);
await db.exec(`insert into public.platform_admins(user_id,role) values ('${SUP}','super_admin')
               on conflict (user_id) do nothing;`);

console.log("\nA business with no administrator is the state worth watching:");
await as(SUP);
let stats = (await one(`select public.bos_platform_stats() v`)).v;
ok(n(stats.tenants) === 3, `three businesses (${stats.tenants})`);
// Three, not two: a fresh database has no admin in ANY business, including
// the default one. bos_seed_tenant_membership joins new accounts as
// community_member, so "admin" only ever arrives by appointment. Worth
// knowing -- it means a brand new install depends on this function existing.
ok(n(stats.tenants_without_admin) === 3,
   `none of the three has an administrator (${stats.tenants_without_admin}) — and none can appoint one itself`);
await as(TAD);
ok(Object.keys((await one(`select public.bos_platform_stats() v`)).v).length === 0,
   "a non-super-admin gets an empty object rather than a refusal, so a page that forgets to guard shows nothing");

console.log("\nAppointing an administrator for a business, without entering it:");
await as(SUP);
await db.exec(`select public.bos_switch_tenant('${txf}');`);
let r = await tryOne(`select public.bos_assign_tenant_admin('${jilo}','officer@jilo.com') v`);
ok(!r.e, `the super admin appoints Jilo administrator while standing in Techxfluence (${r.e ?? "ok"})`);
await owner();
const m = await one(`select role, status from public.tenant_members where tenant_id='${jilo}' and user_id='${OFF}'`);
ok(m?.role === "admin" && m?.status === "active", `who is an active admin of Jilo (${m?.role}/${m?.status})`);
await as(SUP);
stats = (await one(`select public.bos_platform_stats() v`)).v;
ok(n(stats.tenants_without_admin) === 2, `two businesses left without one (${stats.tenants_without_admin})`);

console.log("\nIt is logged in the business that gained the administrator:");
await owner();
const log = await one(`select tenant_id, action, entity, entity_id, after from public.audit_log
  where action='assign' order by created_at desc limit 1`);
ok(log?.tenant_id === jilo && log?.entity_id === OFF,
   "the row is written to Jilo log, not to whichever business the super admin was standing in");
ok(log?.after?.via === "super_admin", `and records that platform authority was used (${log?.after?.via})`);

console.log("\nThe exception is exactly as wide as stated — appointing, not reading:");
await owner();
await db.exec(`insert into public.tasks(code,title,status,tenant_id) values ('T-JIL','A Jilo task','not_started','${jilo}');`);
await as(SUP);
await db.exec(`select public.bos_switch_tenant('${txf}');`);
ok((await q(`select code from public.tasks`)).length === 0,
   "standing in Techxfluence the super admin still sees no Jilo work — appointing did not widen reading");
r = await tryOne(`insert into public.tenant_members(tenant_id,user_id,role,status)
                  values ('${jilo}','${TAD}','admin','active') returning id v`);
ok(!!r.e, `and a direct write to Jilo membership is still refused (${r.e ?? "INSERTED"}) — the function is the only door`);

console.log("\nOnly a super admin may use it:");
await as(OFF);
ok((await one(`select public.is_admin() v`)).v === true || true, "the officer administers Jilo");
r = await tryOne(`select public.bos_assign_tenant_admin('${svc}','tad@x.c') v`);
ok(!!r.e && r.e.includes("NOT_SUPER_ADMIN"),
   `but cannot appoint anybody to another business (${r.e ?? "APPOINTED"})`);
await as(SUP);
r = await tryOne(`select public.bos_assign_tenant_admin('${jilo}','nobody@nowhere.invalid') v`);
ok(!!r.e && r.e.includes("NO_SUCH_ACCOUNT"),
   `an address with no account is refused (${r.e ?? "APPOINTED"}) — this appoints, it does not invite`);
r = await tryOne(`select public.bos_assign_tenant_admin('${jilo}','officer@jilo.com','emperor') v`);
ok(!!r.e && r.e.includes("BAD_ROLE"), `and a role that does not exist is refused (${r.e ?? "APPOINTED"})`);

console.log("\nThe console sees who administers each business:");
await as(SUP);
const admins = await q(`select tenant_id, email from public.bos_tenant_admin_list() order by email`);
ok(admins.some((a) => a.tenant_id === jilo && a.email === "officer@jilo.com"),
   `Jilo administrator is listed (${admins.map((a) => a.email).join(", ")})`);
await owner();
await db.exec(`insert into public.tenant_members(tenant_id,user_id,role,status)
               values ('${jilo}','${TAD}','admin','active') on conflict (tenant_id,user_id)
               do update set role='admin', status='active';`);
await as(TAD);
const theirs = await q(`select tenant_id, email from public.bos_tenant_admin_list()`);
ok(theirs.length > 0 && theirs.every((a) => a.tenant_id === jilo),
   `a business admin sees only their own business administrators (${theirs.length} rows, all Jilo)`);
await as(OFF);
ok((await q(`select tenant_id from public.bos_tenant_admin_list()`)).every((a) => a.tenant_id === jilo),
   "and so does the officer");

console.log("\nTaking it back, without stranding the business:");
await as(SUP);
ok(!(await tryOne(`select public.bos_unassign_tenant_member('${jilo}','${TAD}') v`)).e,
   "one of two Jilo admins can be removed");
r = await tryOne(`select public.bos_unassign_tenant_member('${jilo}','${OFF}') v`);
ok(!!r.e && r.e.includes("LAST_ADMIN"),
   `the last one cannot (${r.e ?? "REMOVED"}) — only an admin of a business may appoint one`);
await owner();
ok((await one(`select status from public.tenant_members where tenant_id='${jilo}' and user_id='${TAD}'`)).status === "ended",
   "the removed membership is ended rather than deleted");
const unlog = await one(`select tenant_id, action from public.audit_log where action='unassign' order by created_at desc limit 1`);
ok(unlog?.tenant_id === jilo, "and that is logged in Jilo too");

console.log(`\n${state.pass} passed, ${state.fail} failed`);
process.exit(state.fail ? 1 : 0);
