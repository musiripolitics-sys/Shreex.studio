/**
 * A child row cannot point at another business's parent row.
 *
 * Found by testing rather than reading: an admin of one business could insert
 * a registration in THEIR tenant whose event_id named an event belonging to
 * somebody else. The foreign key checked the event existed; nothing checked
 * whose it was. Every one of the 66 foreign keys between two tenant-owned
 * tables had that shape.
 *
 * Not a leak on its own — the isolation policies still stopped that admin
 * reading the event. It is the shape a leak grows from: the first query that
 * joins on event_id without also matching tenant_id turns an inconsistent row
 * into visible data.
 */
import { freshDb, counter } from "./_db.mjs";

const { state, ok } = counter();
const { db, skipped } = await freshDb();
ok(skipped.length === 0, `every migration applied cleanly (${skipped.length} failures)`);

const q = async (s) => (await db.query(s)).rows;
const one = async (s) => (await q(s))[0];
const tryExec = async (s) => { try { await db.exec(s); return null; } catch (e) { return e.message.split("\n")[0]; } };
const as = (u) => db.exec(`set role authenticated; set request.jwt.claim.sub='${u}'; set request.jwt.claim.role='authenticated';`);
const owner = () => db.exec(`reset role; reset request.jwt.claim.sub; reset request.jwt.claim.role;`);

const t1 = (await one(`select id from public.tenants where is_default`)).id;
await db.exec(`insert into public.tenants(slug,name) values ('two','Two');`);
const t2 = (await one(`select id from public.tenants where slug='two'`)).id;
const ADA = "11111111-1111-1111-1111-111111111111";
const BEN = "22222222-2222-2222-2222-222222222222";
await db.exec(`insert into auth.users(id,email) values ('${ADA}','a@x.c'),('${BEN}','b@x.c');`);
await db.exec(`update public.users set primary_role='admin' where id in ('${ADA}','${BEN}');`);
await db.exec(`delete from public.tenant_members where user_id='${BEN}';`);
await db.exec(`insert into public.tenant_members(tenant_id,user_id,role,status) values ('${t2}','${BEN}','admin','active');`);

await db.exec(`insert into public.events(slug,title,category,date,city,venue,status,tenant_id)
               values ('ada','Ada Event','Meetup',current_date+5,'X','Y','published','${t1}');`);
const adaEv = (await one(`select id from public.events where slug='ada'`)).id;
await db.exec(`insert into public.goals(code,objective,tenant_id) values ('G-A','Ada goal','${t1}');`);
const adaGoal = (await one(`select id from public.goals where code='G-A'`)).id;

console.log("\nNo foreign key between two tenant-owned tables omits the tenant:");
const open_ = await one(`
  select count(*)::int c
    from pg_constraint k
    join pg_class ch on ch.oid = k.conrelid
    join pg_class pa on pa.oid = k.confrelid
    join pg_namespace n on n.oid = ch.relnamespace
   where n.nspname='public' and k.contype='f'
     and exists (select 1 from pg_attribute a where a.attrelid=ch.oid and a.attname='tenant_id' and a.attnum>0)
     and exists (select 1 from pg_attribute a where a.attrelid=pa.oid and a.attname='tenant_id' and a.attnum>0)
     and not ('tenant_id' = any (select a.attname from pg_attribute a
                                  where a.attrelid=ch.oid and a.attnum = any(k.conkey)))`);
ok(Number(open_.c) === 0,
   Number(open_.c) === 0
     ? "all 66 carry (tenant_id, <column>), so a new one without it is the only way back in"
     : `${open_.c} STILL OMIT IT`);

console.log("\nA cross-tenant child row is refused at the constraint:");
await as(BEN);
for (const [label, sql] of [
  ["a registration on another business's event",
   `insert into public.registrations(event_id,attendee_name,attendee_email,status,tenant_id)
      values ('${adaEv}','Planted','p@x.c','registered','${t2}')`],
  ["a ticket type on it",
   `insert into public.ticket_types(event_id,name,price_amount,capacity,max_per_order,currency,tenant_id)
      values ('${adaEv}','Planted',0,10,5,'INR','${t2}')`],
  ["a task hung off another business's goal",
   `insert into public.tasks(code,title,goal_id,tenant_id)
      values ('T-P','Planted','${adaGoal}','${t2}')`],
]) {
  const e = await tryExec(sql);
  ok(e !== null && /foreign key|violates/i.test(e),
     e !== null ? `${label} is refused` : `${label} WAS ACCEPTED — the hole is open`);
}

console.log("\nAnd the same rows are fine within one business:");
await owner();
await db.exec(`insert into public.events(slug,title,category,date,city,venue,status,tenant_id)
               values ('ben','Ben Event','Meetup',current_date+5,'X','Y','published','${t2}');`);
const benEv = (await one(`select id from public.events where slug='ben'`)).id;
await as(BEN);
const own = await tryExec(`insert into public.registrations(event_id,attendee_name,attendee_email,status,tenant_id)
  values ('${benEv}','Fine','f@x.c','registered','${t2}')`);
ok(own === null, `a registration on his own event is accepted (${own ?? "ok"})`);

console.log("\nDeleting a parent still works, which the composite key nearly broke:");
await owner();
// ON DELETE SET NULL on a composite key would null tenant_id too, and
// tenant_id is NOT NULL -- so the parent would have become undeletable. The
// column is named explicitly so only the reference is cleared.
await db.exec(`insert into public.tasks(code,title,goal_id,tenant_id) values ('T-A','Ada task','${adaGoal}','${t1}');`);
const del = await tryExec(`delete from public.goals where id='${adaGoal}'`);
ok(del === null, `a goal with a task hanging off it can be deleted (${del ?? "ok"})`);
const orphan = await one(`select goal_id, tenant_id from public.tasks where code='T-A'`);
ok(orphan?.goal_id === null && orphan?.tenant_id === t1,
   "and the task survives with goal_id nulled and its tenant intact");

console.log("\nCascades still cascade:");
await owner();
const before = Number((await one(`select count(*)::int c from public.registrations where event_id='${benEv}'`)).c);
await db.exec(`delete from public.events where id='${benEv}';`);
ok(before > 0 && Number((await one(`select count(*)::int c from public.registrations where event_id='${benEv}'`)).c) === 0,
   `deleting an event still removes its registrations (${before} before, 0 after)`);

console.log(`\n${state.pass} passed, ${state.fail} failed`);
process.exit(state.fail ? 1 : 0);
