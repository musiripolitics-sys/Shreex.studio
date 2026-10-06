/**
 * Stage 5, fifth batch — the ticket and order chain.
 *
 * The first section is not about tenancy. fulfil_order is executable by anon
 * and never checked the payment, so create_pending_order followed by
 * fulfil_order(order_id, null) produced free tickets for a paid event. That
 * is asserted first because it is the part that mattered most.
 */
import { freshDb, counter } from "./_db.mjs";

const { state, ok } = counter();
const { db, skipped } = await freshDb();
ok(skipped.length === 0, `every migration applied cleanly (${skipped.length} failures)`);

const q = async (s) => (await db.query(s)).rows;
const one = async (s) => (await q(s))[0];
const tryOne = async (s) => { try { return { v: await one(s) }; } catch (e) { return { e: e.message.split("\n")[0] }; } };
const as = (u) => db.exec(`set role authenticated; set request.jwt.claim.sub='${u}'; set request.jwt.claim.role='authenticated';`);
const asService = () => db.exec(`reset role; reset request.jwt.claim.sub; set request.jwt.claim.role='service_role';`);
const owner = () => db.exec(`reset role; reset request.jwt.claim.sub; reset request.jwt.claim.role;`);

const t1 = (await one(`select id from public.tenants where is_default`)).id;
await db.exec(`insert into public.tenants(slug,name) values ('rival','Rival');`);
const t2 = (await one(`select id from public.tenants where slug='rival'`)).id;

const ADA = "11111111-1111-1111-1111-111111111111";
const BEN = "22222222-2222-2222-2222-222222222222";
const BUY = "33333333-3333-3333-3333-333333333333";
await db.exec(`insert into auth.users(id,email) values ('${ADA}','a@x.c'),('${BEN}','b@x.c'),('${BUY}','buy@x.c');`);
await db.exec(`update public.users set primary_role='admin', full_name='Ada' where id='${ADA}';`);
await db.exec(`update public.users set primary_role='admin', full_name='Ben' where id='${BEN}';`);
await db.exec(`delete from public.tenant_members where user_id='${BEN}';`);
await db.exec(`insert into public.tenant_members(tenant_id,user_id,role,status) values ('${t2}','${BEN}','admin','active');`);

// A paid event in each business.
await db.exec(`delete from public.registrations; delete from public.orders;
               delete from public.ticket_types; delete from public.events;`);
for (const [tn, slug] of [[t1,'ada-gig'],[t2,'ben-gig']]) {
  await db.exec(`insert into public.events(slug,title,category,date,starts_at,city,venue,status,price_amount,spots_left,tenant_id)
                 values ('${slug}','${slug}','Meetup',current_date+7,now()+interval '7 days','X','Y','published',50000,100,'${tn}');`);
  const ev = (await one(`select id from public.events where slug='${slug}'`)).id;
  await db.exec(`insert into public.ticket_types(event_id,name,price_amount,capacity,sold,max_per_order,currency,tenant_id)
                 values ('${ev}','General',50000,100,0,5,'INR','${tn}');`);
}
const adaEv = (await one(`select id from public.events where slug='ada-gig'`)).id;
const adaTt = (await one(`select id from public.ticket_types where event_id='${adaEv}'`)).id;

console.log("\nFree tickets for a paid event are no longer two calls away:");
await as(BUY);
const ord = await tryOne(`select public.create_pending_order('${adaEv}','${adaTt}',1,'Buyer','buy@x.c') v`);
ok(!ord.e, `a buyer holds a seat on a 50000 paise ticket (${ord.e ?? "ok"})`);
const orderId = ord.v?.v?.order_id;
const free = await tryOne(`select public.fulfil_order('${orderId}'::uuid, null) v`);
ok(!!free.e && free.e.includes("PAYMENT_NOT_VERIFIED"),
   `fulfilling it with no payment is refused (${free.e ?? "ISSUED TICKETS FOR FREE"})`);
await owner();
ok(Number((await one(`select count(*)::int c from public.registrations where order_id='${orderId}'`)).c) === 0,
   "and no ticket was issued");
ok((await one(`select status::text s from public.orders where id='${orderId}'`)).s === "pending",
   "the order is still pending rather than marked paid");

console.log("\nA real payment still works:");
// Written as the service role, which is how ticket-verify does it since 0048.
// Before that the route ran as the signed-in user, which is exactly why
// public.payments had to accept a client-written status 'paid' -- and
// therefore accepted one from anybody.
await asService();
await db.exec(`insert into public.payments(user_id,stream,amount,currency,status,provider,related_type,related_id,tenant_id)
               values ('${BUY}','ticket_sales',50000,'INR','paid','razorpay','events','${adaEv}','${t1}');`);
await as(BUY);
const pay = (await one(`select id from public.payments where user_id='${BUY}'`)).id;
const paid = await tryOne(`select public.fulfil_order('${orderId}'::uuid, '${pay}'::uuid) v`);
ok(!paid.e, `the ticket is issued against a paid payment row (${paid.e ?? "ok"})`);
await owner();
ok(Number((await one(`select count(*)::int c from public.registrations where order_id='${orderId}'`)).c) === 1,
   "one registration exists");

console.log("\nAn underpayment does not buy a ticket either:");
await owner();
await db.exec(`delete from public.payments; delete from public.registrations; delete from public.orders;`);
await as(BUY);
const ord2 = (await one(`select public.create_pending_order('${adaEv}','${adaTt}',1,'Buyer','buy@x.c') v`)).v;
await asService();
await db.exec(`insert into public.payments(user_id,stream,amount,currency,status,provider,related_type,related_id,tenant_id)
               values ('${BUY}','ticket_sales',100,'INR','paid','razorpay','events','${adaEv}','${t1}');`);
await as(BUY);
const cheap = (await one(`select id from public.payments where amount=100`)).id;
const under = await tryOne(`select public.fulfil_order('${ord2.order_id}'::uuid, '${cheap}'::uuid) v`);
ok(!!under.e && under.e.includes("PAYMENT_NOT_VERIFIED"),
   `a 100 paise payment against a 50000 paise order is refused (${under.e ?? "ACCEPTED"})`);

console.log("\nA free event still needs no payment:");
await owner();
await db.exec(`delete from public.payments; delete from public.registrations; delete from public.orders;`);
await db.exec(`update public.events set price_amount=0 where id='${adaEv}';
               update public.ticket_types set price_amount=0 where id='${adaTt}';`);
await as(BUY);
const freeOrder = await tryOne(`select public.register_free_order('${adaEv}','${adaTt}',1,'Buyer','buy2@x.c') v`);
ok(!freeOrder.e, `register_free_order goes through (${freeOrder.e ?? "ok"})`);
await owner();
ok(Number((await one(`select count(*)::int c from public.registrations`)).c) === 1,
   "and issues the ticket");
await db.exec(`update public.events set price_amount=50000 where id='${adaEv}';
               update public.ticket_types set price_amount=50000 where id='${adaTt}';`);

console.log("\nAn order cannot be placed on another business's event:");
await as(BEN);
const cross = await tryOne(`select public.create_pending_order('${adaEv}','${adaTt}',1,'Ben','b@x.c') v`);
ok(!!cross.e && cross.e.includes("EVENT_NOT_FOUND"),
   `Ben ordering against Ada's event is refused (${cross.e ?? "ACCEPTED"})`);

console.log("\nThe webhook may still fulfil an order in any business:");
await owner();
await db.exec(`delete from public.registrations; delete from public.orders;`);
await as(BUY);
const o3 = (await one(`select public.create_pending_order('${adaEv}','${adaTt}',1,'Buyer','b3@x.c') v`)).v;
await asService();
const svc = await tryOne(`select public.fulfil_order('${o3.order_id}'::uuid, null) v`);
ok(!svc.e, `the service role fulfils it without a payment row, which is how the verified Razorpay webhook works (${svc.e ?? "ok"})`);

console.log("\nA registration cannot be cancelled across businesses:");
await owner();
ok(Number((await one(`select count(*)::int c from public.registrations`)).c) === 1, "Ada's business has one attendee");
const reg = (await one(`select id from public.registrations`)).id;
await as(BEN);
const cancel = await tryOne(`select public.cancel_registration('${reg}'::uuid) v`);
ok(!!cancel.e && cancel.e.includes("NOT_FOUND"),
   `Ben cancelling it is refused (${cancel.e ?? "THE ROW WAS DELETED"}) — this is the case the Stage 4 suite demonstrated, where the row simply vanished`);
await owner();
ok(Number((await one(`select count(*)::int c from public.registrations`)).c) === 1, "and the attendee is still registered");

console.log("\nThe door scanner only knows its own tickets:");
const code = (await one(`select ticket_code from public.registrations`)).ticket_code;
await as(BEN);
const scan = (await one(`select public.check_in_ticket('${code}') v`)).v;
ok(scan.status === "invalid",
   `Ben scanning Ada's ticket gets "${scan.status}" — the message it already returned is now true`);
await owner();
ok((await one(`select status::text s from public.registrations`)).s === "registered",
   "and the attendee was not checked in");
await as(ADA);
const own = (await one(`select public.check_in_ticket('${code}') v`)).v;
ok(own.status === "ok", `Ada scanning her own gets "${own.status}"`);

console.log("\nA promo is counted against the business that issued it:");
await owner();
await db.exec(`delete from public.registrations; delete from public.orders; delete from public.promo_codes;`);
await db.exec(`insert into public.promo_codes(code,percent_off,active,uses,tenant_id) values
  ('HALF',50,true,0,'${t1}'), ('HALF',50,true,0,'${t2}');`);
await as(BUY);
const o4 = (await one(`select public.create_pending_order('${adaEv}','${adaTt}',1,'B','b4@x.c',null,'HALF') v`)).v;
await asService();
await db.exec(`select public.fulfil_order('${o4.order_id}'::uuid, null);`);
await owner();
const promoUses = await q(`select tenant_id, uses from public.promo_codes order by uses desc`);
ok(promoUses[0].tenant_id === t1 && Number(promoUses[0].uses) === 1,
   "the order's own business counted the redemption, not the default one the webhook would have resolved to");

console.log(`\n${state.pass} passed, ${state.fail} failed`);
process.exit(state.fail ? 1 : 0);
