/**
 * Stage 5, second batch — the rest of Group A.
 *
 * Ten functions, three of which needed a decision rather than a predicate:
 * one overload was dropped as unreachable, one became SECURITY INVOKER so the
 * isolation policies scope it, and bos_section_status kept its definer rights
 * because losing them would change the numbers an employee is shown.
 *
 * Asserted as Ben, an admin of the second business, against a database where
 * the first has data too.
 */
import { freshDb, counter } from "./_db.mjs";

const { state, ok } = counter();
const { db, skipped } = await freshDb();
ok(skipped.length === 0, `every migration applied cleanly (${skipped.length} failures)`);

const q = async (s) => (await db.query(s)).rows;
const one = async (s) => (await q(s))[0];
const tryOne = async (s) => { try { return { v: await one(s) }; } catch (e) { return { e: e.message.split("\n")[0] }; } };
const as = (u) => db.exec(`set role authenticated; set request.jwt.claim.sub='${u}';`);
const owner = () => db.exec(`reset role; reset request.jwt.claim.sub;`);

const t1 = (await one(`select id from public.tenants where is_default`)).id;
await db.exec(`insert into public.tenants(slug,name) values ('rival','Rival');`);
const t2 = (await one(`select id from public.tenants where slug='rival'`)).id;

const ADA = "11111111-1111-1111-1111-111111111111";
const BEN = "22222222-2222-2222-2222-222222222222";
await db.exec(`insert into auth.users(id,email) values ('${ADA}','ada@one.c'),('${BEN}','ben@rival.c');`);
await db.exec(`update public.users set primary_role='admin', full_name='Ada' where id='${ADA}';`);
await db.exec(`update public.users set primary_role='admin', full_name='Ben' where id='${BEN}';`);
await db.exec(`delete from public.tenant_members where user_id='${BEN}';`);
await db.exec(`insert into public.tenant_members(tenant_id,user_id,role,status) values ('${t2}','${BEN}','admin','active');`);

console.log("\nThe unreachable overload is gone rather than scoped:");
const overloads = await q(`
  select pg_get_function_identity_arguments(p.oid) args, p.prosecdef definer
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'bos_dashboard_summary'`);
ok(overloads.length === 1,
   `one bos_dashboard_summary remains (${overloads.length}) — the two-date one could not be called at all, because both overloads defaulted every argument and Postgres refused the call as ambiguous`);
ok(overloads[0]?.definer === false,
   "and the one that is left is SECURITY INVOKER, so the isolation policies scope all 35 of its subqueries without a predicate in any of them");

console.log("\nThe dashboard counts one business, not the platform:");
await owner();
await db.exec(`delete from public.tasks;`);
await db.exec(`insert into public.tasks(code,title,status,tenant_id) values
  ('T-A1','Ada 1','not_started','${t1}'), ('T-A2','Ada 2','blocked','${t1}'),
  ('T-B1','Ben 1','not_started','${t2}');`);
await as(BEN);
const dashB = (await one(`select public.bos_dashboard_summary(null::date,null::date,null::uuid,null::uuid) s`)).s;
ok(Number(dashB.tasks_open) === 1, `Ben's dashboard shows 1 open task (${dashB.tasks_open})`);
await as(ADA);
const dashA = (await one(`select public.bos_dashboard_summary(null::date,null::date,null::uuid,null::uuid) s`)).s;
ok(Number(dashA.tasks_open) === 2, `Ada's shows her 2 (${dashA.tasks_open})`);

console.log("\nbos_section_status counts the same way, and kept its definer rights:");
await as(BEN);
const secB = (await one(`select public.bos_section_status() s`)).s;
ok(Number(secB?.tasks?.total) === 1, `Ben's nav counts 1 task (${secB?.tasks?.total})`);
await as(ADA);
const secA = (await one(`select public.bos_section_status() s`)).s;
ok(Number(secA?.tasks?.total) === 2, `Ada's counts 2 (${secA?.tasks?.total})`);
await owner();
ok((await one(`select prosecdef d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
               where n.nspname='public' and p.proname='bos_section_status'`)).d === true,
   "still definer on purpose — as an invoker an employee counts would shrink to what they can read, which is not the number the nav is asking for");

console.log("\nThe same promo code in two businesses discounts its own tickets:");
await owner();
await db.exec(`delete from public.promo_codes;`);
await db.exec(`insert into public.promo_codes(code,percent_off,active,tenant_id) values
  ('LAUNCH50',50,true,'${t1}'), ('LAUNCH50',10,true,'${t2}');`);
await as(BEN);
ok(Number((await one(`select public.validate_promo('LAUNCH50') v`)).v) === 10,
   `Ben's LAUNCH50 is 10 percent, not Ada's 50 (${(await one(`select public.validate_promo('LAUNCH50') v`)).v})`);
await as(ADA);
ok(Number((await one(`select public.validate_promo('LAUNCH50') v`)).v) === 50, "and Ada's is still 50");

console.log("\nA membership tier does not follow a person between businesses:");
await owner();
await db.exec(`delete from public.memberships;`);
await db.exec(`insert into public.memberships(user_id,tier,status,tenant_id) values ('${ADA}','Elite','active','${t1}');`);
await as(BEN);
ok(Number((await one(`select public.member_discount_pct('${ADA}') v`)).v) === 0,
   "Ada is Elite in her own business and worth no discount in Ben's");
await as(ADA);
ok(Number((await one(`select public.member_discount_pct('${ADA}') v`)).v) === 50, "and 50 percent in hers");

console.log("\nAn id from another business stops answering:");
await owner();
await db.exec(`delete from public.tasks;`);
await db.exec(`insert into public.tasks(code,title,tenant_id) values ('T-ADA','Ada work','${t1}');`);
const adaTask = (await one(`select id from public.tasks where code='T-ADA'`)).id;
await as(BEN);
const blocked = await one(`select public.bos_task_completion_block('${adaTask}') v`);
ok(blocked.v === null,
   `bos_task_completion_block on Ada's task returns nothing to Ben (${JSON.stringify(blocked.v)}) — it used to describe her task state to him`);

await owner();
await db.exec(`delete from public.sop_versions; delete from public.sop_documents;`);
await db.exec(`insert into public.sop_documents(code,title,tenant_id) values ('SOP-1','Doors','${t1}');`);
const sop = (await one(`select id from public.sop_documents where code='SOP-1'`)).id;
await db.exec(`insert into public.sop_versions(sop_id,version,tenant_id) values ('${sop}',1,'${t1}');`);
await as(BEN);
ok((await one(`select public.bos_sop_current('${sop}') v`)).v === null,
   "bos_sop_current resolves nothing for another business SOP");

console.log("\nAnd an event from another business is not found rather than reported on:");
await owner();
await db.exec(`delete from public.registrations; delete from public.events;`);
await db.exec(`insert into public.events(slug,title,category,date,city,venue,status,host_id,tenant_id)
               values ('ada-ev','Ada Event','Meetup',current_date+3,'X','Y','published','${ADA}','${t1}'),
                      ('ben-ev','Ben Event','Meetup',current_date+3,'X','Y','published','${BEN}','${t2}');`);
const adaEv = (await one(`select id from public.events where slug='ada-ev'`)).id;
const benEv = (await one(`select id from public.events where slug='ben-ev'`)).id;
await as(BEN);
const cross = await tryOne(`select public.get_event_stats('${adaEv}') s`);
ok(!!cross.e && cross.e.includes("EVENT_NOT_FOUND"),
   `Ben asking about Ada's event raises EVENT_NOT_FOUND (${cross.e ?? "IT ANSWERED: " + JSON.stringify(cross.v)}) — the permission check below it admits any admin, so the lookup is what closes it`);
const mine = await tryOne(`select public.get_event_stats('${benEv}') s`);
ok(!mine.e, `and his own still reports (${mine.e ?? "ok"})`);

console.log("\nHost earnings are per business, so nobody is paid twice from the wrong pot:");
await owner();
await db.exec(`delete from public.payouts;`);
// One person hosting in both: Ada is a member of tenant 2 as well.
await db.exec(`insert into public.tenant_members(tenant_id,user_id,role,status) values ('${t2}','${ADA}','event_host','active');`);
await db.exec(`update public.events set host_id='${ADA}' where slug in ('ada-ev','ben-ev');`);
await db.exec(`insert into public.payouts(host_id,amount,tenant_id) values ('${ADA}',40000,'${t1}'),('${ADA}',600,'${t2}');`);
await as(ADA);
ok(Number((await one(`select (public.get_host_earnings() ->> 'paid_out')::bigint v`)).v) === 40000,
   "Ada acting in her own business sees her 40000 and not the 600 from the other");

console.log("\nThe public organizer page belongs to one business:");
await as(BEN);
const org = await one(`select public.get_organizer('${ADA}') v`);
ok(org.v !== null, "Ada has an organizer page in Ben's business, because she hosts an event there");
ok(Number(org.v?.events_count) === 1,
   `and it counts only that business events (${org.v?.events_count}) rather than both`);

console.log(`\n${state.pass} passed, ${state.fail} failed`);
process.exit(state.fail ? 1 : 0);
