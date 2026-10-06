/**
 * Stage 5, fourth batch — thirteen Group C mutators.
 *
 * Group C is where a missing predicate stops being disclosure and becomes
 * damage: these act on a row named by an argument, and a definer function
 * bypasses RLS, so an admin of one business could cancel another's
 * registrations or publish its procedures by passing the id.
 *
 * Asserted as Ben, an admin of the second business.
 */
import { freshDb, counter } from "./_db.mjs";

const { state, ok } = counter();
const { db, skipped } = await freshDb();
ok(skipped.length === 0, `every migration applied cleanly (${skipped.length} failures)`);

const q = async (s) => (await db.query(s)).rows;
const one = async (s) => (await q(s))[0];
const tryExec = async (s) => { try { await db.exec(s); return null; } catch (e) { return e.message.split("\n")[0]; } };
const as = (u) => db.exec(`set role authenticated; set request.jwt.claim.sub='${u}';`);
const owner = () => db.exec(`reset role; reset request.jwt.claim.sub;`);

const t1 = (await one(`select id from public.tenants where is_default`)).id;
await db.exec(`insert into public.tenants(slug,name) values ('rival','Rival');`);
const t2 = (await one(`select id from public.tenants where slug='rival'`)).id;

const ADA = "11111111-1111-1111-1111-111111111111";
const BEN = "22222222-2222-2222-2222-222222222222";
const CAL = "33333333-3333-3333-3333-333333333333";
await db.exec(`insert into auth.users(id,email) values ('${ADA}','a@x.c'),('${BEN}','b@x.c'),('${CAL}','c@x.c');`);
await db.exec(`update public.users set primary_role='admin',    full_name='Ada' where id='${ADA}';`);
await db.exec(`update public.users set primary_role='admin',    full_name='Ben' where id='${BEN}';`);
await db.exec(`update public.users set primary_role='employee', full_name='Cal' where id='${CAL}';`);
await db.exec(`delete from public.tenant_members where user_id in ('${BEN}','${CAL}');`);
await db.exec(`insert into public.tenant_members(tenant_id,user_id,role,status) values
  ('${t2}','${BEN}','admin','active'), ('${t2}','${CAL}','employee','active'),
  ('${t1}','${CAL}','employee','active');`);

console.log("\nredeem_promo was broken, not merely leaky:");
await db.exec(`delete from public.promo_codes;`);
await db.exec(`insert into public.promo_codes(code,percent_off,active,uses,tenant_id) values
  ('LAUNCH50',50,true,0,'${t1}'), ('LAUNCH50',10,true,0,'${t2}');`);
await as(BEN);
const pct = await one(`select public.redeem_promo('LAUNCH50') v`);
ok(Number(pct?.v) === 10, `Ben redeems his own and gets 10 percent (${pct?.v}) — this raised "query returned more than one row" before`);
await owner();
const uses = await q(`select percent_off, uses from public.promo_codes order by percent_off`);
ok(uses.find((r) => r.percent_off === 10)?.uses === 1 && uses.find((r) => r.percent_off === 50)?.uses === 0,
   `and only his row was incremented (${uses.map((r) => `${r.percent_off}%→${r.uses}`).join(", ")})`);

console.log("\nMoney cannot be paid to someone from another business:");
await as(BEN);
const payCross = await tryExec(`select public.record_payout('${ADA}', 5000, 'nope')`);
ok(payCross !== null && payCross.includes("NOT_IN_THIS_TENANT"),
   `paying Ada, who is not in Ben's business, is refused (${payCross ?? "ACCEPTED"})`);
const payOwn = await tryExec(`select public.record_payout('${CAL}', 5000, 'ok')`);
ok(payOwn === null, `and paying his own employee works (${payOwn ?? "ok"})`);
await owner();
ok((await one(`select tenant_id from public.payouts where note='ok'`)).tenant_id === t2,
   "with the payout landing in his business");

console.log("\nA section grant is revoked in one business, not in all of them:");
await owner();
await db.exec(`delete from public.employee_module_access;`);
await db.exec(`insert into public.employee_module_access(user_id,section,tenant_id) values
  ('${CAL}','plan','${t1}'), ('${CAL}','plan','${t2}'), ('${CAL}','money','${t2}');`);
await as(BEN);
ok(await tryExec(`select public.bos_set_module_access('${CAL}', array['money'])`) === null,
   "Ben narrows Cal to Money in his own business");
await owner();
const grants = await q(`select section, tenant_id from public.employee_module_access order by section`);
ok(grants.length === 2,
   `two grants remain (${grants.length}) — Cal's Plan in the other business survived`);
ok(grants.some((g) => g.section === "plan" && g.tenant_id === t1),
   "specifically the one Ben has no business touching");

console.log("\nApproving a host writes the membership, not the account:");
await as(BEN);
ok(await tryExec(`select public.decide_host('${CAL}', true)`) === null, "Ben approves Cal as a host");
await owner();
ok((await one(`select role::text r from public.tenant_members where user_id='${CAL}' and tenant_id='${t2}'`)).r === "event_host",
   "Cal is a host in Ben's business");
ok((await one(`select role::text r from public.tenant_members where user_id='${CAL}' and tenant_id='${t1}'`)).r === "employee",
   "and still just an employee in the other — before this it set users.primary_role, which is one field for every business");

console.log("\nProcedures and reports belong to the business that wrote them:");
await owner();
await db.exec(`delete from public.sop_versions; delete from public.sop_documents;`);
await db.exec(`insert into public.sop_documents(code,title,state,tenant_id) values ('S-1','Doors','draft','${t1}');`);
const sop = (await one(`select id from public.sop_documents where code='S-1'`)).id;
await db.exec(`insert into public.sop_versions(sop_id,version,tenant_id) values ('${sop}',1,'${t1}');`);
const ver = (await one(`select id from public.sop_versions where sop_id='${sop}'`)).id;
await as(BEN);
const pub = await tryExec(`select public.bos_publish_sop('${ver}')`);
ok(pub !== null && /No such version/i.test(pub),
   `Ben cannot publish Ada's procedure (${pub ?? "ACCEPTED"})`);
await owner();
ok((await one(`select state::text s from public.sop_documents where id='${sop}'`)).s === "draft",
   "and it is still a draft");

await db.exec(`delete from public.post_reports; delete from public.posts;`);
await db.exec(`insert into public.posts(author_id,author_name,body,tenant_id)
               values ('${ADA}','Ada','hello','${t1}');`);
const post = (await one(`select id from public.posts`)).id;
await db.exec(`insert into public.post_reports(post_id,reporter_id,reason,resolved,tenant_id)
               values ('${post}','${ADA}','spam',false,'${t1}');`);
const rep = (await one(`select id from public.post_reports`)).id;
await as(BEN);
await db.exec(`select public.resolve_report('${rep}');`);
await owner();
ok((await one(`select resolved from public.post_reports where id='${rep}'`)).resolved === false,
   "resolve_report on another business report changes nothing");

console.log("\nCredits can only be awarded to someone in the business:");
await owner();
await db.exec(`delete from public.point_events; update public.users set points=0;`);
await as(BEN);
await db.exec(`select public.award_credits('${ADA}', 100, 'nope');`);
ok(Number((await one(`select points from public.users where id='${ADA}'`)).points) === 0,
   "awarding Ada, who is not in Ben's business, does nothing");
await db.exec(`select public.award_credits('${CAL}', 100, 'ok');`);
await owner();
ok(Number((await one(`select points from public.users where id='${CAL}'`)).points) === 100,
   "and his own employee is credited");
ok((await one(`select tenant_id from public.point_events where reason='ok'`)).tenant_id === t2,
   "with the ledger row in his business");

console.log("\nAttendance counted for a badge is this business's attendance:");
await owner();
await db.exec(`delete from public.user_badges; delete from public.badges; delete from public.registrations; delete from public.events;`);
await db.exec(`insert into public.events(slug,title,category,date,city,venue,status,tenant_id) values
  ('e1','E1','Meetup',current_date,'X','Y','completed','${t1}'),
  ('e2','E2','Meetup',current_date,'X','Y','completed','${t2}');`);
const [e1, e2] = [(await one(`select id from public.events where slug='e1'`)).id,
                  (await one(`select id from public.events where slug='e2'`)).id];
await db.exec(`insert into public.registrations(event_id,user_id,attendee_name,attendee_email,status,tenant_id) values
  ('${e1}','${CAL}','Cal','c@x.c','attended','${t1}'),
  ('${e2}','${CAL}','Cal','c@x.c','attended','${t2}');`);
await db.exec(`insert into public.badges(slug,name,criteria,threshold,tenant_id) values
  ('two-events','Two events','attendance',2,'${t2}');`);
await as(BEN);
await db.exec(`select public.refresh_badges('${CAL}');`);
await owner();
ok(Number((await one(`select count(*)::int c from public.user_badges`)).c) === 0,
   "Cal attended one event in each business, so a badge needing two is not awarded — the counts used to add up across businesses");

console.log("\nA notification lands in the business it is about:");
await as(BEN);
await db.exec(`delete from public.notifications;`);
await db.exec(`select public.notify('${CAL}','test','Hi',null,null);`);
await owner();
ok((await one(`select tenant_id from public.notifications where title='Hi'`)).tenant_id === t2,
   "named explicitly rather than left to the column default");

console.log("\nThe daily sweeper still sweeps every business:");
await owner();
await db.exec(`delete from public.orders;`);
await db.exec(`insert into public.orders(event_id,buyer_name,buyer_email,quantity,status,expires_at,tenant_id) values
  ('${e1}','A','a@x.c',1,'pending',now() - interval '1 hour','${t1}'),
  ('${e2}','B','b@x.c',1,'pending',now() - interval '1 hour','${t2}');`);
// No auth.uid(), which is how the cron runs it.
const swept = await one(`select public.expire_pending_orders() n`);
ok(Number(swept?.n) === 2,
   `with no caller it expires both businesses' stale orders (${swept?.n}) — scoping it to the default tenant would have quietly stopped it running for everyone else`);
await owner();
await db.exec(`update public.orders set status='pending';`);
await as(BEN);
const sweptOwn = await one(`select public.expire_pending_orders() n`);
ok(Number(sweptOwn?.n) === 1, `and a signed-in admin sweeps only their own (${sweptOwn?.n})`);

console.log("\nAnd a waitlist cannot be joined on another business's event:");
await as(BEN);
const wl = await tryExec(`select public.join_waitlist('${e1}','X','x@y.c',null)`);
ok(wl !== null && wl.includes("EVENT_NOT_FOUND"),
   `Ada's event is not found rather than joined (${wl ?? "ACCEPTED"})`);

console.log(`\n${state.pass} passed, ${state.fail} failed`);
process.exit(state.fail ? 1 : 0);
