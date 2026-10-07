/**
 * 0056 — one-week sprints.
 *
 * The numbers are the point, so they are what gets asserted. Throughput on its
 * own rewards speed over value — which the research is loudest about and which
 * most teams get wrong because velocity is the easy thing to calculate — so
 * carry-over, overrun and unestimated are checked beside it.
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

const t1 = (await one(`select id from public.tenants where is_default`)).id;
await db.exec(`insert into public.tenants(slug,name) values ('two','Business Two');`);
const t2 = (await one(`select id from public.tenants where slug='two'`)).id;
const ADA = "11111111-1111-1111-1111-111111111111";
const BEN = "22222222-2222-2222-2222-222222222222";
await db.exec(`insert into auth.users(id,email) values ('${ADA}','ada@x.c'),('${BEN}','ben@x.c');`);
await db.exec(`delete from public.tenant_members where user_id in ('${ADA}','${BEN}');`);
await db.exec(`insert into public.tenant_members(tenant_id,user_id,role,status) values
  ('${t1}','${ADA}','admin','active'), ('${t2}','${BEN}','admin','active');`);

console.log("\nA sprint is a week, anchored on Monday:");
await as(ADA);
let r = await tryOne(`select public.bos_ensure_sprint() v`);
ok(!r.e, `this week's sprint exists (${r.e ?? "ok"})`);
const sp = r.v?.v;
await owner();
const s = await one(`select number, starts_on::text st, ends_on::text en, status,
  extract(isodow from starts_on) dow from public.sprints where id='${sp}'`);
ok(n(s.dow) === 1, `it starts on a Monday (isodow ${s.dow})`);
ok(new Date(s.en) - new Date(s.st) === 6 * 86400000, `and runs seven days (${s.st} to ${s.en})`);
ok(s.status === "active", "the week containing today is active");
ok(n(s.number) === 1, "numbered from one, per business");

console.log("\nAsking twice gives the same sprint, not two:");
await as(ADA);
const again = await tryOne(`select public.bos_ensure_sprint() v`);
ok(again.v?.v === sp, "idempotent per business per week");
await owner();
ok(n((await one(`select count(*) c from public.sprints where tenant_id='${t1}'`)).c) === 1, "still one sprint");
const dup = await tryOne(`insert into public.sprints(tenant_id,number,starts_on) values ('${t1}',99,'${s.st}') returning id v`);
ok(!!dup.e, `and a second sprint for the same week is refused by the index, not by trust (${dup.e ? "refused" : "ALLOWED"})`);

console.log("\nA sprint that does not start on a Monday is refused:");
await owner();
const notMon = await tryOne(`insert into public.sprints(tenant_id,number,starts_on) values ('${t1}',98,'${s.st}'::date + 2) returning id v`);
ok(!!notMon.e && notMon.e.includes("sprints_starts_monday"), `the CHECK catches it (${notMon.e ? "refused" : "ALLOWED"})`);

console.log("\nEvery product feeds the same sprint, and the numbers come out:");
await owner();
await db.exec(`insert into public.tasks(code,title,status,estimate_hours,actual_hours,sprint_id,tenant_id) values
  ('T-1','Events task','completed',8,10,'${sp}','${t1}'),
  ('T-2','Finance task','completed',4,3,'${sp}','${t1}'),
  ('T-3','Marketing task','in_progress',6,2,'${sp}','${t1}'),
  ('T-4','Unestimated task','not_started',null,null,'${sp}','${t1}'),
  ('T-5','Blocked task','blocked',5,0,'${sp}','${t1}'),
  ('T-6','Backlog task','not_started',3,null,null,'${t1}');`);
await as(ADA);
const m = (await one(`select public.bos_sprint_metrics() v`)).v;
ok(n(m.stories) === 5, `five stories in the sprint, the backlog one excluded (${m.stories})`);
ok(n(m.done) === 2 && n(m.blocked) === 1, `done and blocked counted (${m.done} done, ${m.blocked} blocked)`);
ok(n(m.committed_hours) === 23, `committed hours summed (${m.committed_hours})`);
ok(n(m.done_hours) === 12, `and only completed ones count toward done (${m.done_hours})`);
ok(n(m.unestimated) === 1, `the unestimated story is surfaced (${m.unestimated}) — velocity with a hole in it is not velocity`);
ok(n(m.overrun_hours) === 2, `overrun is real hours past estimate on finished work (${m.overrun_hours}) — T-1 took 10 against 8, T-2 came in under and does not offset it`);
ok(n(m.day) >= 1 && n(m.day) <= 7, `day of the sprint is within the week (${m.day})`);

console.log("\nThe numbers are per business, like everything else:");
await as(BEN);
await tryOne(`select public.bos_ensure_sprint() v`);
const bm = (await one(`select public.bos_sprint_metrics() v`)).v;
ok(n(bm.stories) === 0, `Ben's sprint is empty (${bm.stories}) — Ada's work is not his`);
ok(n(bm.number) === 1, "and his sprint is numbered 1 too, because numbering is per business");

console.log("\nA story cannot be committed to another business's sprint:");
await owner();
const cross = await tryOne(`insert into public.tasks(code,title,status,sprint_id,tenant_id)
  values ('T-X','Cross tenant','not_started','${sp}','${t2}') returning id v`);
ok(!!cross.e, `the composite foreign key refuses it (${cross.e ? "refused" : "ALLOWED"})`);

console.log("\nClosing the week moves what is unfinished and records how much:");
await as(ADA);
const closed = await tryOne(`select public.bos_close_sprint() v`);
ok(!closed.e, `closed (${closed.e ?? "ok"})`);
ok(n(closed.v?.v?.carried_out) === 3, `three unfinished stories carried (${closed.v?.v?.carried_out}) — in progress, not started and blocked`);
const next = closed.v?.v?.next;
await owner();
ok((await one(`select status, carried_out from public.sprints where id='${sp}'`)).status === "closed", "the sprint is closed");
ok(n((await one(`select carried_out from public.sprints where id='${sp}'`)).carried_out) === 3,
   "and the count is recorded on it, so it survives those stories moving on");
ok(n((await one(`select count(*) c from public.tasks where sprint_id='${next}'`)).c) === 3, "they are in next week");
ok(n((await one(`select count(*) c from public.tasks where sprint_id='${sp}'`)).c) === 2, "the finished two stayed where they happened");
await as(ADA);
ok(!!(await tryOne(`select public.bos_close_sprint('${sp}') v`)).e, "and closing it twice is refused");

console.log("\nHistory is what makes velocity mean anything:");
await as(ADA);
const hist = await q(`select number, done, committed_hours, carried_out from public.bos_sprint_history(8)`);
ok(hist.length === 2, `two sprints so far (${hist.length})`);
ok(n(hist.find((h) => n(h.carried_out) === 3)?.done) === 2, "the closed one kept its done count");

console.log("\nCeremonies are recorded, and the action is the one that matters:");
await owner();
await db.exec(`insert into public.sprint_notes(sprint_id,kind,body,author_id,tenant_id) values
  ('${sp}','retro_bad','Estimates were optimistic','${ADA}','${t1}'),
  ('${sp}','retro_action','Split anything over 8 hours at refinement','${ADA}','${t1}');`);
await as(ADA);
ok(n((await one(`select count(*) c from public.sprint_notes where kind='retro_action'`)).c) === 1,
   "an action came out of the retro, which is the difference between a retrospective and a meeting");
await as(BEN);
ok(n((await one(`select count(*) c from public.sprint_notes`)).c) === 0, "and Ben cannot read Ada's retro");

console.log(`\n${state.pass} passed, ${state.fail} failed`);
process.exit(state.fail ? 1 : 0);
