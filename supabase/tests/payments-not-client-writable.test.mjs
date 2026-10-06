/**
 * A person cannot write the record of what they were charged.
 *
 * The remaining half of the fulfil_order finding. 0043 required a paid
 * payment row before issuing tickets and said openly that it raised the bar
 * without closing the door, because the policies on public.payments let the
 * person being charged write that row. This is the door.
 */
import { freshDb, counter } from "./_db.mjs";

const { state, ok } = counter();
const { db, skipped } = await freshDb();
ok(skipped.length === 0, `every migration applied cleanly (${skipped.length} failures)`);

const q = async (s) => (await db.query(s)).rows;
const one = async (s) => (await q(s))[0];
const tryExec = async (s) => { try { await db.exec(s); return null; } catch (e) { return e.message.split("\n")[0]; } };
const as = (u) => db.exec(`set role authenticated; set request.jwt.claim.sub='${u}'; set request.jwt.claim.role='authenticated';`);
const asService = () => db.exec(`reset role; set request.jwt.claim.role='service_role';`);
const owner = () => db.exec(`reset role; reset request.jwt.claim.sub; reset request.jwt.claim.role;`);

const t1 = (await one(`select id from public.tenants where is_default`)).id;
const BUY = "33333333-3333-3333-3333-333333333333";
const ADM = "11111111-1111-1111-1111-111111111111";
await db.exec(`insert into auth.users(id,email) values ('${BUY}','buy@x.c'),('${ADM}','a@x.c');`);
await db.exec(`update public.users set primary_role='admin', full_name='Ada' where id='${ADM}';`);

console.log("\nThe client-writable policies are gone:");
const pol = await q(`select policyname, cmd from pg_policies where tablename='payments' order by policyname`);
const names = pol.map((p) => p.policyname);
ok(!names.includes("record own payment"),
   `no "record own payment" insert policy (${names.join(", ")})`);
ok(!names.includes("update own payment"), "and no self-update policy");
ok(names.includes("read own payments"), "but a person can still see their own receipts");

console.log("\nA buyer cannot record a payment for themselves:");
await as(BUY);
const ins = await tryExec(`insert into public.payments(user_id,stream,amount,currency,status,provider,tenant_id)
  values ('${BUY}','ticket_sales',50000,'INR','paid','razorpay','${t1}')`);
ok(ins !== null && /row-level security/i.test(ins),
   `refused (${ins ?? "WROTE A PAID PAYMENT — STILL OPEN"})`);
await owner();
ok(Number((await one(`select count(*)::int c from public.payments`)).c) === 0, "and nothing was written");

console.log("\nNor change one that already exists:");
await asService();
await db.exec(`insert into public.payments(user_id,stream,amount,currency,status,provider,tenant_id)
  values ('${BUY}','ticket_sales',50000,'INR','paid','razorpay','${t1}');`);
await owner();
const pay = (await one(`select id, amount from public.payments`)).id;
await as(BUY);
await db.exec(`update public.payments set amount = 1 where id = '${pay}';`);
await owner();
ok(Number((await one(`select amount from public.payments where id='${pay}'`)).amount) === 50000,
   "the amount recorded against a completed purchase is not writable by the purchaser");

console.log("\nAnd they can still read it:");
await as(BUY);
ok((await q(`select amount from public.payments`)).length === 1, "their own receipt is visible");

console.log("\nThe three legitimate writers still work:");
await asService();
const svc = await tryExec(`insert into public.payments(user_id,stream,amount,currency,status,provider,tenant_id)
  values ('${BUY}','membership',9900,'INR','paid','razorpay','${t1}')`);
ok(svc === null, `the service role writes, which is what the verification routes and the webhook use now (${svc ?? "ok"})`);
await as(ADM);
const adm = await tryExec(`insert into public.payments(user_id,stream,amount,currency,status,provider,tenant_id)
  values ('${ADM}','sponsorship',1000,'INR','paid','manual','${t1}')`);
ok(adm === null, `and an admin can still correct the books by hand (${adm ?? "ok"})`);

console.log("\nThe exploit chain is closed end to end:");
await owner();
await db.exec(`delete from public.payments; delete from public.registrations; delete from public.orders;`);
await db.exec(`insert into public.events(slug,title,category,date,starts_at,city,venue,status,price_amount,spots_left,tenant_id)
  values ('gig','Gig','Meetup',current_date+7,now()+interval '7 days','X','Y','published',50000,100,'${t1}');`);
const ev = (await one(`select id from public.events where slug='gig'`)).id;
await db.exec(`insert into public.ticket_types(event_id,name,price_amount,capacity,sold,max_per_order,currency,tenant_id)
  values ('${ev}','GA',50000,100,0,5,'INR','${t1}');`);
const tt = (await one(`select id from public.ticket_types where event_id='${ev}'`)).id;
await as(BUY);
const ord = (await one(`select public.create_pending_order('${ev}','${tt}',1,'B','b@x.c') v`)).v;
// Step 1 of the old exploit: forge the payment. Refused above.
const forge = await tryExec(`insert into public.payments(user_id,stream,amount,currency,status,provider,tenant_id)
  values ('${BUY}','ticket_sales',50000,'INR','paid','razorpay','${t1}')`);
ok(forge !== null, "the payment cannot be forged");
// Step 2: fulfil without one. Refused by 0043.
let err = null;
try { await db.exec(`select public.fulfil_order('${ord.order_id}'::uuid, null);`); } catch (e) { err = e.message.split("\n")[0]; }
ok(err !== null && err.includes("PAYMENT_NOT_VERIFIED"), `and the order cannot be fulfilled without one (${err ?? "TICKETS ISSUED"})`);
await owner();
ok(Number((await one(`select count(*)::int c from public.registrations`)).c) === 0, "no ticket exists");

console.log(`\n${state.pass} passed, ${state.fail} failed`);
process.exit(state.fail ? 1 : 0);
