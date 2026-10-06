/**
 * Stage 6 — the isolation test, run for real.
 *
 * The architecture document called this "the control that actually prevents
 * the leak": run every row-spanning function as two different tenants and
 * assert the results are disjoint. It could not be written until a second
 * tenant was possible, and tenancy-definers has reported it as pending ever
 * since Stage 0, because an assertion that passes vacuously is worse than one
 * that does not run.
 *
 * It needs no knowledge of what each function does, which is the point: a
 * nineteenth group A function added next month is covered by adding one line
 * here, and the guard in tenancy-definers refuses an unclassified one anyway.
 */
import { freshDb, counter } from "./_db.mjs";

const { state, ok } = counter();
const { db, skipped } = await freshDb();
ok(skipped.length === 0, `every migration applied cleanly (${skipped.length} failures)`);

const q = async (s) => (await db.query(s)).rows;
const one = async (s) => (await q(s))[0];
const asIn = (u, t) => db.exec(
  `set role authenticated; set request.jwt.claim.sub='${u}'; set request.jwt.claim.role='authenticated'; set request.jwt.claim.tenant_id='${t}';`);
const owner = () => db.exec(`reset role; reset request.jwt.claim.sub; reset request.jwt.claim.role; reset request.jwt.claim.tenant_id;`);

// ── Two businesses, each with a full set of rows ──
const t1 = (await one(`select id from public.tenants where is_default`)).id;
await db.exec(`insert into public.tenants(slug,name) values ('two','Business Two');`);
const t2 = (await one(`select id from public.tenants where slug='two'`)).id;

const U = { a: "11111111-1111-1111-1111-111111111111", b: "22222222-2222-2222-2222-222222222222" };
await db.exec(`insert into auth.users(id,email) values ('${U.a}','a@one.c'),('${U.b}','b@two.c');`);
for (const [k, t] of [["a", t1], ["b", t2]]) {
  await db.exec(`update public.users set primary_role='admin', full_name='Admin ${k.toUpperCase()}',
                 discoverable=true, points=400 where id='${U[k]}';`);
  await db.exec(`delete from public.tenant_members where user_id='${U[k]}';`);
  await db.exec(`insert into public.tenant_members(tenant_id,user_id,role,status)
                 values ('${t}','${U[k]}','admin','active');`);
}

// One of everything the group A functions read, in each business, with values
// that deliberately COLLIDE so a leak shows up as a duplicate rather than as
// a bigger number.
const ids = { a: {}, b: {} };
for (const [k, t] of [["a", t1], ["b", t2]]) {
  const u = U[k];
  await db.exec(`insert into public.risks(code,risk,area,owner_id,impact,likelihood,next_review,tenant_id)
                 values ('R-01','Risk ${k}','Events','${u}',5,5,current_date - 10,'${t}');`);
  await db.exec(`insert into public.complaints(subject,detail,severity,complainant,contact_email,owner_id,tenant_id)
                 values ('Complaint ${k}','d',1,'X','x@y.c','${u}','${t}');`);
  await db.exec(`insert into public.cities(name,is_active,tenant_id) values ('City ${k}',true,'${t}');`);
  await db.exec(`insert into public.partners(name,is_active,tenant_id) values ('Partner ${k}',true,'${t}');`);
  await db.exec(`insert into public.memberships(user_id,tier,status,tenant_id)
                 values ('${u}','Elite','active','${t}');`);
  await db.exec(`insert into public.promo_codes(code,percent_off,active,tenant_id)
                 values ('SHARED',${k === "a" ? 50 : 10},true,'${t}');`);
  await db.exec(`insert into public.events(slug,title,category,date,starts_at,city,venue,status,host_id,price_amount,spots_left,tenant_id)
                 values ('summit','Summit','Meetup',current_date+7,now()+interval '7 days','X','Y','published','${u}',0,50,'${t}');`);
  ids[k].event = (await one(`select id from public.events where tenant_id='${t}'`)).id;
  await db.exec(`insert into public.ticket_types(event_id,name,price_amount,capacity,sold,max_per_order,currency,tenant_id)
                 values ('${ids[k].event}','GA',0,50,0,5,'INR','${t}');`);
  await db.exec(`insert into public.registrations(event_id,user_id,attendee_name,attendee_email,status,tenant_id)
                 values ('${ids[k].event}','${u}','Attendee ${k}','r${k}@y.c','attended','${t}');`);
  await db.exec(`insert into public.payouts(host_id,amount,tenant_id) values ('${u}',${k === "a" ? 90000 : 7000},'${t}');`);
  await db.exec(`insert into public.tasks(code,title,owner_id,status,tenant_id)
                 values ('T-01','Task ${k}','${u}','not_started','${t}');`);
  ids[k].task = (await one(`select id from public.tasks where tenant_id='${t}'`)).id;
  await db.exec(`insert into public.sop_documents(code,title,tenant_id) values ('S-01','SOP ${k}','${t}');`);
  ids[k].sop = (await one(`select id from public.sop_documents where tenant_id='${t}'`)).id;
  await db.exec(`insert into public.sop_versions(sop_id,version,tenant_id) values ('${ids[k].sop}',1,'${t}');`);
  await db.exec(`insert into public.assets(name,owner_id,review_date,tenant_id)
                 values ('Asset ${k}','${u}',current_date - 5,'${t}');`);
}
await owner();

// ── 1. Set-returning and aggregating functions: disjoint results ──
//
// Each is called as an admin of each business. The two result sets must share
// no row. Values collide on purpose, so a leak reads as a duplicate.
const spanning = [
  ["bos_govern_attention()",   `select label from public.bos_govern_attention() order by label`],
  ["bos_user_directory()",     `select full_name from public.bos_user_directory() order by full_name`],
  ["get_directory()",          `select full_name from public.get_directory() order by full_name`],
  ["get_top_members(10)",      `select full_name from public.get_top_members(10) order by full_name`],
  ["get_all_host_earnings()",  `select host_name || ':' || paid_out as r from public.get_all_host_earnings() order by r`],
];

console.log("\nEvery row-spanning function returns disjoint sets for two tenants:");
for (const [name, sql] of spanning) {
  await asIn(U.a, t1);
  const A = (await q(sql)).map((r) => Object.values(r)[0]);
  await asIn(U.b, t2);
  const B = (await q(sql)).map((r) => Object.values(r)[0]);
  const shared = A.filter((x) => B.includes(x));
  const bothNonEmpty = A.length > 0 && B.length > 0;
  ok(bothNonEmpty && shared.length === 0,
     shared.length > 0
       ? `${name} LEAKS: both tenants see ${JSON.stringify(shared)}`
       : bothNonEmpty
         ? `${name} — ${A.length} row(s) for one, ${B.length} for the other, nothing in common`
         : `${name} returned nothing for one of them (${A.length}/${B.length}), so this proves nothing`);
}

// ── 2. Aggregates: different numbers, from the same shape of data ──
console.log("\nAggregates count one business:");
const aggregates = [
  ["public_stats().cities",       `select (public.public_stats() ->> 'cities')::int v`, 1],
  ["public_stats().partners",     `select (public.public_stats() ->> 'partners')::int v`, 1],
  ["bos_section_status().risks",  `select (public.bos_section_status() -> 'risks' ->> 'total')::int v`, 1],
  ["bos_dashboard_summary.tasks", `select (public.bos_dashboard_summary(null::date,null::date,null::uuid,null::uuid) ->> 'tasks_open')::int v`, 1],
];
for (const [name, sql, expected] of aggregates) {
  await asIn(U.a, t1);
  const a = Number((await one(sql)).v);
  await asIn(U.b, t2);
  const b = Number((await one(sql)).v);
  ok(a === expected && b === expected,
     a === expected && b === expected
       ? `${name} is ${expected} for each, not ${expected * 2} for both`
       : `${name} READS ACROSS: ${a} and ${b}, expected ${expected} each`);
}

// ── 3. Functions taking an id: the other tenant's id must not answer ──
console.log("\nAn id from the other business does not answer:");
const byId = [
  ["get_event_stats",            (o) => `select public.get_event_stats('${o.event}') v`, "raises"],
  ["bos_task_completion_block",  (o) => `select public.bos_task_completion_block('${o.task}') v`, "null"],
  ["bos_sop_current",            (o) => `select public.bos_sop_current('${o.sop}') v`, "null"],
  ["event_attendance",           (o) => `select going from public.event_attendance(array['${o.event}']::uuid[])`, "zero"],
  ["member_discount_pct",        () => `select public.member_discount_pct('${U.a}') v`, "zero"],
];
for (const [name, build, want] of byId) {
  await asIn(U.b, t2);           // acting in business two
  const sql = build(ids.a);      // asking about business one
  let res, err = null;
  try { res = Object.values(await one(sql))[0]; } catch (e) { err = e.message.split("\n")[0]; }
  const good = want === "raises" ? err !== null
             : want === "null"   ? (err === null && res === null)
             : /* zero */          (err === null && Number(res) === 0);
  ok(good, good
    ? `${name} ${want === "raises" ? `raises (${err})` : `answers ${JSON.stringify(res)}`} for the other business id`
    : `${name} ANSWERED: ${err ?? JSON.stringify(res)} — expected ${want}`);
}

// ── 4. A shared value resolves to the caller's own ──
console.log("\nA value both businesses use resolves to the caller's own:");
await asIn(U.a, t1);
const promoA = Number((await one(`select public.validate_promo('SHARED') v`)).v);
await asIn(U.b, t2);
const promoB = Number((await one(`select public.validate_promo('SHARED') v`)).v);
ok(promoA === 50 && promoB === 10, `SHARED is 50 percent in one and 10 in the other (${promoA}/${promoB})`);

await asIn(U.a, t1);
const slugA = (await one(`select public.bos_event_slug('Summit') v`)).v;
await asIn(U.b, t2);
const slugB = (await one(`select public.bos_event_slug('Summit') v`)).v;
ok(slugA === "summit-2" && slugB === "summit-2",
   `each gets summit-2, clashing only with its own event (${slugA}/${slugB}) — one scan across both would have given summit-2 and summit-3`);

await asIn(U.a, t1);
const earnA = Number((await one(`select (public.get_host_earnings() ->> 'paid_out')::bigint v`)).v);
await asIn(U.b, t2);
const earnB = Number((await one(`select (public.get_host_earnings() ->> 'paid_out')::bigint v`)).v);
ok(earnA === 90000 && earnB === 7000, `each host sees their own payout (${earnA}/${earnB}), not the sum`);

// ── 5. And the predicates ──
// These four were the find: each opened with a bare "is_admin() or ...", so
// the first branch short-circuited and any admin passed for any row, however
// carefully the rest had been scoped in 0040. 0046 puts an outer tenant gate
// in front of the branches.
console.log("\nPredicates answer about the caller's business only, admin or not:");
await owner();
await db.exec(`insert into public.goals(code,objective,owner_id,tenant_id)
               values ('G-01','Goal a','${U.a}','${t1}'), ('G-01','Goal b','${U.b}','${t2}');`);
const goalA = (await one(`select id from public.goals where tenant_id='${t1}'`)).id;
await db.exec(`insert into public.communities(slug,name,status,join_policy,is_public,tenant_id)
               values ('c','Chapter a','published','open',true,'${t1}'),
                      ('c','Chapter b','published','open',true,'${t2}');`);
const comA = (await one(`select id from public.communities where tenant_id='${t1}'`)).id;
await db.exec(`insert into public.community_members(community_id,user_id,role,state,tenant_id)
               values ('${comA}','${U.a}','organizer','active','${t1}');`);

await asIn(U.b, t2);
ok((await one(`select public.is_admin() v`)).v === true, "the caller is an admin of their own business");
for (const [fn, id, label] of [
  ["bos_can_see_task",   ids.a.task, "a task"],
  ["bos_can_see_goal",   goalA,      "a goal"],
  ["can_read_community", comA,       "a chapter"],
  ["community_leads",    comA,       "a chapter they do not lead"],
]) {
  const v = (await one(`select public.${fn}('${id}') v`)).v;
  ok(v === false, v === false
    ? `${fn} refuses ${label} in the other business`
    : `${fn} ANSWERED TRUE about ${label} in the other business — the admin short circuit`);
}
ok((await one(`select public.attended('${ids.a.event}') v`)).v === false, "attended refuses the other business event");

console.log("\nAnd still answers about their own:");
await asIn(U.a, t1);
ok((await one(`select public.bos_can_see_task('${ids.a.task}') v`)).v === true, "an admin sees their own task");
ok((await one(`select public.bos_can_see_goal('${goalA}') v`)).v === true, "and their own goal");
ok((await one(`select public.can_read_community('${comA}') v`)).v === true, "and can read their own chapter");
ok((await one(`select public.community_leads('${comA}') v`)).v === true, "and leads it");

console.log(`\n${state.pass} passed, ${state.fail} failed`);
process.exit(state.fail ? 1 : 0);
