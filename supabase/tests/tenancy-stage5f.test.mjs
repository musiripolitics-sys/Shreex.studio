/**
 * Stage 5, final batch — the last nine Group C mutators and the eleven
 * Group D triggers.
 *
 * The headline assertion is the last one: every SECURITY DEFINER function in
 * the database either carries a tenant predicate or is one of six that
 * deliberately does not, pinned by name. That number is what Stage 5 was for.
 */
import { freshDb, counter } from "./_db.mjs";

const { state, ok } = counter();
const { db, skipped } = await freshDb();
ok(skipped.length === 0, `every migration applied cleanly (${skipped.length} failures)`);

const q = async (s) => (await db.query(s)).rows;
const one = async (s) => (await q(s))[0];
const tryOne = async (s) => { try { return { v: await one(s) }; } catch (e) { return { e: e.message.split("\n")[0] }; } };
const as = (u) => db.exec(`set role authenticated; set request.jwt.claim.sub='${u}'; set request.jwt.claim.role='authenticated'; reset request.jwt.claim.tenant_id;`);
// Cal belongs to BOTH businesses, so "their own membership decides" is
// genuinely ambiguous for him -- bos_request_tenant takes the first by
// joined_at. Any assertion about Cal has to name the tenant, which is what the
// claim is for and why 0041 made a refused claim deny rather than fall back.
const asIn = (u, t) => db.exec(`set role authenticated; set request.jwt.claim.sub='${u}'; set request.jwt.claim.role='authenticated'; set request.jwt.claim.tenant_id='${t}';`);
const owner = () => db.exec(`reset role; reset request.jwt.claim.sub; reset request.jwt.claim.role; reset request.jwt.claim.tenant_id;`);

const t1 = (await one(`select id from public.tenants where is_default`)).id;
await db.exec(`insert into public.tenants(slug,name) values ('rival','Rival');`);
const t2 = (await one(`select id from public.tenants where slug='rival'`)).id;

const ADA = "11111111-1111-1111-1111-111111111111";
const BEN = "22222222-2222-2222-2222-222222222222";
const CAL = "33333333-3333-3333-3333-333333333333";
await db.exec(`insert into auth.users(id,email) values ('${ADA}','a@x.c'),('${BEN}','b@x.c'),('${CAL}','c@x.c');`);
await db.exec(`update public.users set primary_role='admin', full_name='Ada', points=500 where id='${ADA}';`);
await db.exec(`update public.users set primary_role='admin', full_name='Ben', points=500 where id='${BEN}';`);
await db.exec(`update public.users set primary_role='employee', full_name='Cal', points=500 where id='${CAL}';`);
await db.exec(`delete from public.tenant_members where user_id in ('${BEN}','${CAL}');`);
await db.exec(`insert into public.tenant_members(tenant_id,user_id,role,status) values
  ('${t2}','${BEN}','admin','active'), ('${t2}','${CAL}','employee','active'),
  ('${t1}','${CAL}','employee','active');`);

console.log("\nA gated file belongs to the business that posted it:");
await db.exec(`delete from public.file_unlocks; delete from public.community_files;`);
await db.exec(`insert into public.community_files(title,storage_path,created_by,credit_cost,tenant_id)
               values ('Ada deck','ada/deck.pdf','${ADA}',100,'${t1}');`);
const file = (await one(`select id from public.community_files`)).id;
await as(BEN);
const unlocked = (await one(`select public.unlock_file('${file}') v`)).v;
ok(unlocked.status === "denied" && !unlocked.path,
   `Ben is denied and gets no path (${unlocked.status}) — this is the case the Stage 4 suite showed handing over the URL`);
await owner();
ok(Number((await one(`select count(*)::int c from public.file_unlocks`)).c) === 0,
   "and no unlock was recorded against his credits");

console.log("\nA credit ledger entry lands in the business it was spent in:");
await db.exec(`delete from public.point_events;`);
await asIn(CAL, t1);
await db.exec(`select public.spend_credits(10,'bought something');`);
await owner();
ok((await one(`select tenant_id from public.point_events`)).tenant_id === t1,
   "Cal acting in the first business files the entry there");

console.log("\nA chapter cannot be joined across businesses:");
await db.exec(`delete from public.community_members; delete from public.communities;`);
await db.exec(`insert into public.communities(slug,name,status,join_policy,tenant_id)
               values ('ada-c','Ada Chapter','published','open','${t1}');`);
const com = (await one(`select id from public.communities where slug='ada-c'`)).id;
await as(BEN);
const joined = (await one(`select public.join_community('${com}') v`)).v;
ok(joined.status === "denied", `Ben gets "Chapter not found" (${joined.status})`);
await asIn(CAL, t1);
ok((await one(`select public.join_community('${com}') v`)).v.status === "joined",
   "and Cal, who belongs to that business, joins");

console.log("\nThe member count counts one business's members:");
await owner();
await db.exec(`insert into public.communities(slug,name,status,join_policy,tenant_id)
               values ('ben-c','Ben Chapter','published','open','${t2}');`);
const com2 = (await one(`select id from public.communities where slug='ben-c'`)).id;
await db.exec(`insert into public.community_members(community_id,user_id,role,state,tenant_id)
               values ('${com2}','${BEN}','member','active','${t2}');`);
ok(Number((await one(`select member_count from public.communities where id='${com}'`)).member_count) === 1,
   `Ada's chapter still counts 1 (${(await one(`select member_count from public.communities where id='${com}'`)).member_count})`);

console.log("\nA report reaches the admins of the business, not every admin:");
await owner();
await db.exec(`delete from public.notifications; delete from public.post_reports; delete from public.posts;`);
await db.exec(`insert into public.posts(author_id,author_name,body,tenant_id)
               values ('${BEN}','Ben','something','${t2}');`);
const post = (await one(`select id from public.posts`)).id;
await asIn(CAL, t1);
const reported = (await one(`select public.report_content('${post}', null, 'spam') v`)).v;
ok(reported.status === "denied",
   `Cal, acting in the first business, cannot report a post in the second (${reported.status})`);
await asIn(CAL, t2);
const ok2 = (await one(`select public.report_content('${post}', null, 'spam') v`)).v;
ok(ok2.status === "ok", `acting in the second business it goes through (${ok2.status})`);
await owner();
const notified = await q(`select n.user_id, n.tenant_id from public.notifications n where n.type='report'`);
ok(notified.length === 1 && notified[0].user_id === BEN,
   `only Ben was notified (${notified.length} notification${notified.length === 1 ? "" : "s"}) — it used to read public.user_roles, which is the PLATFORM admin list`);

console.log("\nAn approval cannot be decided from another business:");
await owner();
await db.exec(`delete from public.approvals;`);
await db.exec(`insert into public.approvals(request_type,request_title,requester_id,decision,tenant_id)
               values ('Task','Ada needs sign-off','${ADA}','pending','${t1}');`);
const appr = (await one(`select id from public.approvals`)).id;
await as(BEN);
const decided = await tryOne(`select public.decide_approval('${appr}','approved')`);
ok(!!decided.e && decided.e.includes("NOT_FOUND"), `Ben is refused (${decided.e ?? "DECIDED IT"})`);
await owner();
ok((await one(`select decision::text d from public.approvals`)).d === "pending", "and it is still pending");

console.log("\nRate limits are per business:");
await owner();
await db.exec(`delete from public.rate_limits;`);
await as(ADA);
for (let i = 0; i < 3; i++) await db.exec(`select public.bos_rate_limit('t','same@x.c',3,interval '1 hour');`);
ok((await one(`select public.bos_rate_limit('t','same@x.c',3,interval '1 hour') v`)).v === false,
   "Ada's fourth hit in her business is refused");
await as(BEN);
ok((await one(`select public.bos_rate_limit('t','same@x.c',3,interval '1 hour') v`)).v === true,
   "and the same address has a fresh allowance in Ben's — one business being spammed no longer exhausts another");

console.log("\nThe roadmap sync only reads its own goals:");
await owner();
await db.exec(`delete from public.tasks; delete from public.goals;`);
await db.exec(`insert into public.goals(code,objective,tenant_id) values
  ('G-A','Ada goal','${t1}'), ('G-B','Ben goal','${t2}');`);
await as(BEN);
const synced = (await one(`select public.bos_sync_roadmap_tasks() v`)).v;
ok(Number(synced) === 1, `Ben's sync creates one task, from his one goal (${synced})`);
await owner();
ok((await one(`select tenant_id from public.tasks`)).tenant_id === t2, "in his business");

console.log("\nA change is logged against the business whose record changed:");
await owner();
await db.exec(`delete from public.govern_changes; delete from public.risks;`);
await db.exec(`insert into public.risks(code,risk,area,impact,likelihood,next_review,tenant_id)
               values ('R-B','Ben risk','Events',3,3,current_date,'${t2}');`);
await db.exec(`update public.risks set mitigation='a plan' where code='R-B';`);
const change = await one(`select tenant_id from public.govern_changes limit 1`);
ok(change?.tenant_id === t2,
   "written as the owner, with no request tenant, the log row still carries the row's own tenant");

console.log("\nA task notification is filed in the task's business:");
await owner();
await db.exec(`delete from public.notifications; delete from public.task_reviews; delete from public.tasks;`);
await db.exec(`insert into public.tasks(code,title,owner_id,status,tenant_id)
               values ('T-B','Ben task','${CAL}','not_started','${t2}');`);
const task = (await one(`select id from public.tasks`)).id;
await db.exec(`insert into public.task_reviews(task_id,outcome,tenant_id) values ('${task}','pending','${t2}');`);
await db.exec(`update public.task_reviews set outcome='met' where task_id='${task}';`);
const note = await one(`select tenant_id, user_id from public.notifications where type='review'`);
ok(note?.tenant_id === t2 && note?.user_id === CAL,
   "the review notification goes to the owner, in the task's business, not in whichever one the writer was acting in");

console.log("\nAnd Stage 5 is finished:");
const unscoped = await q(`
  select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and p.prosrc not like '%bos_request_tenant%'
     and p.prosrc not like '%tenant_id%'
     and p.prosrc not like '%tenant_members%'
   order by 1`);
// Pinned by name. Each is scoped through a delegate or operates on a table
// that is global by design; a seventh appearing here is a regression.
const allowed = [
  "bos_guard_contact_rate()",     // via bos_rate_limit, whose key carries the tenant
  "bos_guard_newsletter_rate()",  // same
  "handle_new_user()",            // public.users is global
  "is_employee()",                // delegates to bos_is_staff
  "is_paid_member()",             // delegates to is_admin and member_tier
  "sync_user_email()",            // public.users is global
];
const got = unscoped.map((r) => r.sig);
ok(JSON.stringify(got) === JSON.stringify(allowed),
   JSON.stringify(got) === JSON.stringify(allowed)
     ? `exactly six definer functions carry no tenant reference, and all six are deliberate: ${allowed.map((a) => a.replace("()", "")).join(", ")}`
     : `CHANGED — now unscoped: ${got.join(", ")}`);

console.log(`\n${state.pass} passed, ${state.fail} failed`);
process.exit(state.fail ? 1 : 0);
