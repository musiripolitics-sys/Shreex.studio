/**
 * Stage 5, first batch — the reads that span rows no longer span tenants.
 *
 * Eight SECURITY DEFINER functions: every set-returning one, plus
 * public_stats and bos_event_slug. A definer function bypasses RLS, so the
 * isolation policies from 0037 never run inside it; the predicate has to be
 * in the body, and this is where that gets checked.
 *
 * Every assertion is made as Ben, an admin of the SECOND business, against a
 * database where the first business has data too. Before 0038,
 * bos_govern_attention handed him both.
 */
import { freshDb, counter } from "./_db.mjs";

const { state, ok } = counter();
const { db, skipped } = await freshDb();
ok(skipped.length === 0, `every migration applied cleanly (${skipped.length} failures)`);

const q = async (s) => (await db.query(s)).rows;
const one = async (s) => (await q(s))[0];
const as = (u) => db.exec(`set role authenticated; set request.jwt.claim.sub='${u}';`);
const owner = () => db.exec(`reset role; reset request.jwt.claim.sub;`);

const t1 = (await one(`select id from public.tenants where is_default`)).id;
await db.exec(`insert into public.tenants(slug,name) values ('rival','Rival');`);
const t2 = (await one(`select id from public.tenants where slug='rival'`)).id;

const ADA = "11111111-1111-1111-1111-111111111111";  // admin of tenant 1
const BEN = "22222222-2222-2222-2222-222222222222";  // admin of tenant 2
const CAL = "33333333-3333-3333-3333-333333333333";  // employee of tenant 2
await db.exec(`insert into auth.users(id,email) values
  ('${ADA}','ada@one.c'),('${BEN}','ben@rival.c'),('${CAL}','cal@rival.c');`);
await db.exec(`update public.users set primary_role='admin',    full_name='Ada', discoverable=true, points=500 where id='${ADA}';`);
await db.exec(`update public.users set primary_role='admin',    full_name='Ben', discoverable=true, points=400 where id='${BEN}';`);
await db.exec(`update public.users set primary_role='employee', full_name='Cal', discoverable=true, points=300 where id='${CAL}';`);
// Ada in tenant 1 only; Ben and Cal in tenant 2 only.
await db.exec(`delete from public.tenant_members where user_id in ('${BEN}','${CAL}');`);
await db.exec(`insert into public.tenant_members(tenant_id,user_id,role,status) values
  ('${t2}','${BEN}','admin','active'), ('${t2}','${CAL}','employee','active');`);

console.log("\nbos_govern_attention — the leak that was measured before this batch:");
await db.exec(`delete from public.risks;`);
for (const [tn, code, who] of [[t1,'R-A','Ada risk'], [t2,'R-B','Ben risk']]) {
  await db.exec(`insert into public.risks(code,risk,area,impact,likelihood,next_review,tenant_id)
                 values ('${code}','${who}','Events',5,5,current_date - 30,'${tn}');`);
}
await as(BEN);
const gov = await q(`select label from public.bos_govern_attention()`);
ok(gov.length === 1 && gov[0].label.includes("Ben"),
   `Ben sees one overdue item, his own (${gov.map((r) => r.label).join(", ") || "none"})`);
await as(ADA);
const govA = await q(`select label from public.bos_govern_attention()`);
ok(govA.length === 1 && govA[0].label.includes("Ada"),
   `Ada sees one, hers (${govA.map((r) => r.label).join(", ") || "none"})`);

console.log("\nbos_user_directory — the staff list, and whose role it reports:");
await as(BEN);
const dir = await q(`select full_name, primary_role from public.bos_user_directory() order by full_name`);
ok(dir.length === 2 && dir.every((r) => r.full_name !== "Ada"),
   `Ben sees his own two colleagues and not Ada (${dir.map((r) => r.full_name).join(", ") || "none"})`);
ok(dir.find((r) => r.full_name === "Cal")?.primary_role === "employee",
   "and the role shown is the one held in THIS tenant, read from tenant_members");

console.log("\nA role is per-tenant, which this directory now proves:");
await owner();
// Cal is an employee of tenant 2 and an admin of tenant 1.
await db.exec(`insert into public.tenant_members(tenant_id,user_id,role,status)
               values ('${t1}','${CAL}','admin','active');`);
await as(BEN);
ok((await q(`select primary_role from public.bos_user_directory() where full_name='Cal'`))[0]?.primary_role === "employee",
   "Cal is an admin in the other business and still an employee in this one");

console.log("\nget_top_members — one leaderboard per business, not one for the platform:");
await as(BEN);
const top = await q(`select full_name from public.get_top_members(10) order by full_name`);
ok(top.length === 2 && !top.some((r) => r.full_name === "Ada"),
   `Ben's leaderboard holds his two members (${top.map((r) => r.full_name).join(", ") || "none"})`);

console.log("\npublic_stats — the numbers on the public home page:");
await owner();
await db.exec(`delete from public.cities; delete from public.partners;`);
await db.exec(`insert into public.cities(name,is_active,tenant_id) values ('Chennai',true,'${t1}'),('Delhi',true,'${t2}');`);
await db.exec(`insert into public.partners(name,is_active,tenant_id) values ('P1',true,'${t1}'),('P2',true,'${t2}'),('P3',true,'${t2}');`);
await as(BEN);
const st = (await one(`select public.public_stats() s`)).s;
ok(Number(st.cities) === 1 && Number(st.partners) === 2,
   `Ben's install reports 1 city and 2 partners, not 2 and 3 (${JSON.stringify(st)})`);
ok(Number(st.members) === 2,
   `and counts memberships rather than accounts (${st.members} of ${(await one(`select count(*)::int c from public.users`)).c} accounts)`);

console.log("\nevent_attendance — an event id from another business answers zero:");
await owner();
await db.exec(`delete from public.registrations; delete from public.events;`);
for (const [tn, slug] of [[t1,'ada-summit'], [t2,'ben-summit']]) {
  await db.exec(`insert into public.events(slug,title,category,date,city,venue,status,tenant_id)
                 values ('${slug}','${slug}','Meetup',current_date+7,'X','Y','published','${tn}');`);
}
const e1 = (await one(`select id from public.events where slug='ada-summit'`)).id;
const e2 = (await one(`select id from public.events where slug='ben-summit'`)).id;
await db.exec(`insert into public.registrations(event_id,attendee_name,attendee_email,status,tenant_id)
               values ('${e1}','Someone','s@a.c','registered','${t1}'),
                      ('${e2}','Other','o@b.c','registered','${t2}');`);
await as(BEN);
const att = await q(`select event_id, going from public.event_attendance(array['${e1}','${e2}']::uuid[]) order by going`);
const forOther = att.find((r) => r.event_id === e1);
const forMine = att.find((r) => r.event_id === e2);
ok(Number(forOther?.going) === 0,
   `passing Ada's event id returns 0 going (${forOther?.going}) — the ids were never ownership-checked, so filtering the registrations is what closes it`);
ok(Number(forMine?.going) === 1, `and his own event still reports 1 (${forMine?.going})`);

console.log("\nget_all_host_earnings — the sharpest of the eleven:");
await owner();
await db.exec(`delete from public.payouts;`);
await db.exec(`update public.events set host_id='${ADA}' where slug='ada-summit';`);
await db.exec(`update public.events set host_id='${BEN}' where slug='ben-summit';`);
await db.exec(`insert into public.payouts(host_id,amount,tenant_id) values ('${ADA}',50000,'${t1}'),('${BEN}',7000,'${t2}');`);
await as(BEN);
const earn = await q(`select host_name, paid_out from public.get_all_host_earnings()`);
ok(earn.length === 1 && earn[0].host_name === "Ben",
   `Ben sees one host, himself (${earn.map((r) => `${r.host_name}:${r.paid_out}`).join(", ") || "none"})`);
ok(Number(earn[0]?.paid_out) === 7000, "with his own payout and not Ada's 50000");

console.log("\nbos_event_slug — a slug is unique per business now, so the scan is too:");
await as(BEN);
ok((await one(`select public.bos_event_slug('Ada Summit') s`)).s === "ada-summit",
   "Ben naming an event the same thing as Ada gets ada-summit, not ada-summit-2");
ok((await one(`select public.bos_event_slug('Ben Summit') s`)).s === "ben-summit-2",
   "and clashing with his OWN event still appends a number");

console.log("\nget_directory — the public member directory:");
await owner();
await db.exec(`delete from public.memberships;`);
await db.exec(`insert into public.memberships(user_id,tier,status,tenant_id) values
  ('${ADA}','Elite','active','${t1}'), ('${BEN}','Elite','active','${t2}');`);
await as(BEN);
const pubdir = await q(`select full_name from public.get_directory() order by full_name`);
ok(!pubdir.some((r) => r.full_name === "Ada"),
   `Ada does not appear in the other business directory (${pubdir.map((r) => r.full_name).join(", ") || "none"})`);

console.log("\nGroup A is complete, read from the function bodies:");
await owner();
// Stated as a fact about the code rather than a measured leak. An empty table
// would make a cross-tenant count read as zero and prove nothing either way.
const unscoped = await q(`
  select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and p.proname in ('bos_dashboard_summary','bos_section_status','get_event_stats',
                       'get_organizer','member_discount_pct','validate_promo',
                       'bos_sop_current','bos_task_completion_block','get_host_earnings')
     and p.prosrc not like '%bos_request_tenant%'
     and p.prosrc not like '%tenant_id%'
   order by 1`);
// Pinned as a set, not a count, so finishing one shows up as a named change
// rather than as an off-by-one.
// Emptied by 0039. Group A is complete: every function in it either carries
// a tenant predicate, became SECURITY INVOKER so the policies scope it, or
// was dropped as unreachable.
const stillOpen = [];
const got = unscoped.map((r) => r.sig).sort();
ok(JSON.stringify(got) === JSON.stringify([...stillOpen].sort()),
   JSON.stringify(got) === JSON.stringify([...stillOpen].sort())
     ? `no Group A function is left without a tenant predicate`
     : `CHANGED — now open: ${got.join(", ")}`);
for (const r of unscoped) console.log(`  ⚠️  ${r.sig}`);
console.log("      B, C, D and E remain: 58 functions.");

console.log(`\n${state.pass} passed, ${state.fail} failed`);
process.exit(state.fail ? 1 : 0);
