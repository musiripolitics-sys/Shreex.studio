/**
 * Stage 5, third batch — role becomes a property of a membership.
 *
 * The most consequential change in the project: is_admin() is called from
 * roughly 200 policies, and this changes what it means. Group B rides along
 * because nearly every one of its predicates opens with "is_admin() or ...",
 * so scoping them while is_admin stayed tenant-blind would have left the
 * short circuit open.
 *
 * The legacy fallback is the part worth reading closely. tenant_members.role
 * is copied from users.primary_role and nothing copies it on a PROMOTION, so
 * a membership role can go stale and reading only tenant_members would
 * quietly demote whoever that happened to. The fallback covers that, but only
 * inside the default tenant — otherwise a platform-wide admin flag would leak
 * admin rights sideways into every business the person merely belongs to.
 * Both halves are asserted.
 */
import { freshDb, counter } from "./_db.mjs";

const { state, ok } = counter();
const { db, skipped } = await freshDb();
ok(skipped.length === 0, `every migration applied cleanly (${skipped.length} failures)`);

const q = async (s) => (await db.query(s)).rows;
const one = async (s) => (await q(s))[0];
const as = (u, t) => db.exec(
  `set role authenticated; set request.jwt.claim.sub='${u}';` +
  (t ? ` set request.jwt.claim.tenant_id='${t}';` : ` reset request.jwt.claim.tenant_id;`));
const owner = () => db.exec(`reset role; reset request.jwt.claim.sub; reset request.jwt.claim.tenant_id;`);

const t1 = (await one(`select id from public.tenants where is_default`)).id;
await db.exec(`insert into public.tenants(slug,name) values ('rival','Rival');`);
const t2 = (await one(`select id from public.tenants where slug='rival'`)).id;

const ADA = "11111111-1111-1111-1111-111111111111"; // admin of t1 only
const CAL = "22222222-2222-2222-2222-222222222222"; // employee of t1, admin of t2
const DEE = "33333333-3333-3333-3333-333333333333"; // the drift case
const EVE = "44444444-4444-4444-4444-444444444444"; // member of neither
await db.exec(`insert into auth.users(id,email) values
  ('${ADA}','ada@x.c'),('${CAL}','cal@x.c'),('${DEE}','dee@x.c'),('${EVE}','eve@x.c');`);
await db.exec(`update public.users set primary_role='admin',            full_name='Ada' where id='${ADA}';`);
await db.exec(`update public.users set primary_role='employee',         full_name='Cal' where id='${CAL}';`);
await db.exec(`update public.users set primary_role='community_member', full_name='Dee' where id='${DEE}';`);
await db.exec(`update public.users set primary_role='community_member', full_name='Eve' where id='${EVE}';`);
// The trigger put all four in t1 with their role at insert time; fix those up.
await db.exec(`update public.tenant_members set role='admin'            where user_id='${ADA}' and tenant_id='${t1}';`);
await db.exec(`update public.tenant_members set role='employee'         where user_id='${CAL}' and tenant_id='${t1}';`);
await db.exec(`update public.tenant_members set role='community_member' where user_id='${DEE}' and tenant_id='${t1}';`);
await db.exec(`delete from public.tenant_members where user_id='${EVE}';`);
// Cal and Dee also belong to the second business; Cal runs it.
await db.exec(`insert into public.tenant_members(tenant_id,user_id,role,status) values
  ('${t2}','${CAL}','admin','active'), ('${t2}','${DEE}','community_member','active');`);

console.log("\nAdmin is a fact about a person in a tenant:");
await as(CAL);
ok((await one(`select public.is_admin() v`)).v === false,
   "Cal is an employee in the business he is acting in, so not an admin there");
await as(CAL, t2);
ok((await one(`select public.is_admin() v`)).v === true,
   "and an admin in the one he runs — the same account, two answers");
await as(ADA);
ok((await one(`select public.is_admin() v`)).v === true, "Ada is an admin of hers");
await as(ADA, t2);
ok((await one(`select public.is_admin() v`)).v === false,
   "and nothing at all in Cal's, because she has no membership there — the claim is checked against membership before it is honoured");
await as(EVE);
ok((await one(`select public.is_admin() v`)).v === false, "Eve belongs to no business and is nobody");

console.log("\nStaff and host follow the membership too:");
await as(CAL);
ok((await one(`select public.bos_is_staff() v`)).v === true, "Cal is staff where he is an employee");
await as(CAL, t2);
ok((await one(`select public.bos_is_staff() v`)).v === true, "and staff where he is an admin");
await as(DEE);
ok((await one(`select public.bos_is_staff() v`)).v === false, "Dee is a community member and not staff");
await owner();
await db.exec(`update public.tenant_members set role='event_host' where user_id='${DEE}' and tenant_id='${t2}';`);
await as(DEE, t2);
ok((await one(`select public.is_host() v`)).v === true, "Dee hosts for the second business");
await as(DEE);
ok((await one(`select public.is_host() v`)).v === false, "and not for the first");

console.log("\nThe legacy fallback keeps a drifted role working, in the default tenant:");
await owner();
// Dee is promoted the way createEmployee does it: users.primary_role only.
// Her membership role stays what it was, which is the drift this guards.
await db.exec(`update public.users set primary_role='admin' where id='${DEE}';`);
await as(DEE);
ok((await one(`select public.is_admin() v`)).v === true,
   "promoted on users.primary_role alone, Dee is still an admin of the default tenant rather than silently demoted");
ok((await one(`select role::text r from public.tenant_members where user_id='${DEE}' and tenant_id='${t1}'`))?.r !== "admin",
   "and her membership row is indeed still stale, so it is the fallback doing the work");

console.log("\nAnd it does NOT leak sideways into another business:");
await as(DEE, t2);
ok((await one(`select public.is_admin() v`)).v === false,
   "a platform-wide admin flag buys her nothing in the second business, where only the membership counts");

console.log("\nA product grant belongs to a membership, not to an account:");
await owner();
await db.exec(`delete from public.employee_module_access;`);
await db.exec(`insert into public.employee_module_access(user_id,section,tenant_id) values ('${CAL}','plan','${t1}');`);
await as(CAL);
ok((await one(`select public.bos_can_access('plan') v`)).v === true, "Cal was granted Plan in the first business");
await owner();
await db.exec(`update public.tenant_members set role='employee' where user_id='${CAL}' and tenant_id='${t2}';`);
await as(CAL, t2);
ok((await one(`select public.bos_can_access('plan') v`)).v === false,
   "and as an employee of the second it grants him nothing — before this, one grant opened the door at every business");
const secs = (await one(`select public.bos_my_sections() s`)).s;
ok(Array.isArray(secs) && secs.length === 0,
   `bos_my_sections agrees (${JSON.stringify(secs)})`);

console.log("\nAnd the predicate the Stage 4 suite caught leaking is closed:");
await owner();
await db.exec(`delete from public.tasks;`);
await db.exec(`insert into public.tasks(code,title,owner_id,tenant_id) values
  ('T-ADA','Ada work','${ADA}','${t1}'), ('T-CAL','Cal work','${CAL}','${t2}');`);
const adaTask = (await one(`select id from public.tasks where code='T-ADA'`)).id;
const calTask = (await one(`select id from public.tasks where code='T-CAL'`)).id;
await as(CAL, t2);
ok((await one(`select public.bos_can_see_task('${adaTask}') v`)).v === false,
   "an admin of the second business cannot see a task in the first — this answered true before 0040");
ok((await one(`select public.bos_can_see_task('${calTask}') v`)).v === true, "and can see his own");
await as(ADA);
ok((await one(`select public.bos_can_see_goal('${adaTask}') v`)).v === true,
   "bos_can_see_goal still admits an admin of the right tenant");

console.log("\nA membership tier is sold by one business:");
await owner();
await db.exec(`delete from public.memberships;`);
await db.exec(`insert into public.memberships(user_id,tier,status,tenant_id) values ('${DEE}','Elite','active','${t1}');`);
await as(DEE);
ok((await one(`select public.member_tier() v`)).v === "Elite", "Dee is Elite where she bought it");
await as(DEE, t2);
ok((await one(`select public.member_tier() v`)).v === null, "and nothing where she did not");

console.log(`\n${state.pass} passed, ${state.fail} failed`);
process.exit(state.fail ? 1 : 0);
