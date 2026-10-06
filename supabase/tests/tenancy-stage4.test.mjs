/**
 * Tenant isolation — Stage 4 of the BOS Product Model plan.
 *
 * This is the first suite in the project that can actually fail to isolate.
 * Everything before it was preparation; a bug here is a cross-tenant read.
 *
 * It runs as `authenticated`, never as the owner. PGlite connects as postgres,
 * which is a superuser and bypasses RLS entirely — an assertion made as the
 * owner would pass while measuring nothing, which is the exact mistake this
 * project made once already.
 */
import { freshDb, counter } from "./_db.mjs";

const { state, ok } = counter();
const { db, skipped } = await freshDb();
ok(skipped.length === 0, `every migration applied cleanly (${skipped.length} failures)`);

const q = async (s) => (await db.query(s)).rows;
const one = async (s) => (await q(s))[0];
const tryExec = async (s) => { try { await db.exec(s); return null; } catch (e) { return e.message.split("\n")[0]; } };
const as = (u, t) => db.exec(
  `set role authenticated; set request.jwt.claim.sub='${u}';` +
  (t ? ` set request.jwt.claim.tenant_id='${t}';` : ` reset request.jwt.claim.tenant_id;`));
const owner = () => db.exec(`reset role; reset request.jwt.claim.sub; reset request.jwt.claim.tenant_id;`);

const t1 = (await one(`select id from public.tenants where is_default`)).id;
await db.exec(`insert into public.tenants(slug,name) values ('rival','Rival Business');`);
const t2 = (await one(`select id from public.tenants where slug='rival'`)).id;

// Two admins, one in each business. Ada is also the platform admin, which is
// the interesting case: is_admin() is still true for her everywhere.
const ADA = "11111111-1111-1111-1111-111111111111";
const BEN = "22222222-2222-2222-2222-222222222222";
await db.exec(`insert into auth.users(id,email) values ('${ADA}','ada@one.c'),('${BEN}','ben@rival.c');`);
await db.exec(`update public.users set primary_role='admin', full_name='Ada' where id='${ADA}';`);
await db.exec(`update public.users set primary_role='admin', full_name='Ben' where id='${BEN}';`);
// Ada belongs to tenant 1 only; Ben to tenant 2 only.
await db.exec(`delete from public.tenant_members where user_id='${BEN}';`);
await db.exec(`insert into public.tenant_members(tenant_id,user_id,role,status)
               values ('${t2}','${BEN}','admin','active');`);

// A task in each business, written as the owner so neither policy is involved
// in setting the stage.
await db.exec(`delete from public.tasks;`);
await db.exec(`insert into public.tasks(code,title,tenant_id) values ('T-001','Ada work','${t1}');`);
await db.exec(`insert into public.tasks(code,title,tenant_id) values ('T-001','Ben work','${t2}');`);

console.log("\nThe policy is restrictive, not permissive:");
const pol = await one(`select permissive, roles::text r, qual, with_check
                         from pg_policies where tablename='tasks' and policyname='tenant isolation'`);
ok(pol?.permissive === "RESTRICTIVE",
   `tasks "tenant isolation" is ${pol?.permissive} — a PERMISSIVE one would be OR-ed with the existing rules and widen access instead of narrowing it`);
ok(/authenticated/.test(pol.r) && /anon/.test(pol.r) && !/service_role/.test(pol.r),
   `and applies to authenticated and anon only, leaving the service role alone (${pol.r})`);
ok(pol.qual !== null && pol.with_check !== null,
   "with both USING and WITH CHECK — without the check, a tenant could write rows labelled with somebody else's tenant_id");

console.log("\nNeither admin can see the other business:");
await as(ADA);
const adaTasks = await q(`select title from public.tasks`);
ok(adaTasks.length === 1 && adaTasks[0].title === "Ada work",
   `Ada sees one task, her own (${adaTasks.map((r) => r.title).join(", ") || "none"})`);
await as(BEN);
const benTasks = await q(`select title from public.tasks`);
ok(benTasks.length === 1 && benTasks[0].title === "Ben work",
   `Ben sees one task, his own (${benTasks.map((r) => r.title).join(", ") || "none"})`);

console.log("\nA platform admin is not a way around it:");
await as(ADA);
ok((await one(`select public.is_admin() a`)).a === true, "Ada is still is_admin() — the old authority is untouched");
ok(Number((await one(`select count(*)::int c from public.tasks`)).c) === 1,
   "and it buys her nothing in the other tenant: a restrictive policy is AND-ed with every permissive one, including the admin ones");

console.log("\nA claim cannot be used to cross over:");
await as(ADA, t2);
const crossed = await q(`select title from public.tasks`);
// Nothing, not "her own". Until 0041 this returned Ada's row: the claim was
// correctly refused and then the fallback put her back in the default tenant.
// A request scoped to a business she does not belong to is now answered with
// no tenant at all, and a restrictive policy against NULL matches no row.
ok(crossed.length === 0,
   `Ada asking for tenant 2 by claim sees nothing (${crossed.map((r) => r.title).join(", ") || "none"}) — a refused claim denies rather than falling back to the default tenant`);
await as(ADA);
ok((await q(`select title from public.tasks`)).length === 1,
   "and dropping the claim puts her back in her own business");

console.log("\nWrites cannot land in another business:");
await as(BEN);
const stolen = await tryExec(
  `insert into public.tasks(code,title,tenant_id) values ('T-999','Planted','${t1}')`);
ok(stolen !== null && /row-level security/i.test(stolen),
   `Ben writing into tenant 1 is refused by WITH CHECK (${stolen ?? "ACCEPTED — THIS IS A LEAK"})`);
const mine = await tryExec(`insert into public.tasks(code,title) values ('T-500','Ben new')`);
ok(mine === null, `but writing into his own works, with no tenant named (${mine ?? "accepted"})`);
ok((await one(`select tenant_id from public.tasks where code='T-500'`)).tenant_id === t2,
   "and the column default put it in his tenant");

console.log("\nAn update cannot move a row to another business:");
await as(BEN);
const moved = await tryExec(`update public.tasks set tenant_id='${t1}' where code='T-500'`);
ok(moved !== null && /row-level security/i.test(moved),
   `re-labelling a row with someone else's tenant is refused (${moved ?? "ACCEPTED — THIS IS A LEAK"})`);

console.log("\nAnd a delete cannot reach across:");
await as(BEN);
await db.exec(`delete from public.tasks where code='T-001';`);
await owner();
ok(Number((await one(`select count(*)::int c from public.tasks where tenant_id='${t1}' and code='T-001'`)).c) === 1,
   "Ben deleting T-001 removed his own and left Ada's standing");

console.log("\nThe public site still works for an anonymous visitor:");
await owner();
await db.exec(`delete from public.events;`);
await db.exec(`insert into public.events(slug,title,category,date,city,venue,status,tenant_id)
               values ('summit','Summit','Meetup',current_date + 7,'Chennai','Hall','published','${t1}');`);
await db.exec(`insert into public.events(slug,title,category,date,city,venue,status,tenant_id)
               values ('summit','Rival Summit','Meetup',current_date + 7,'Delhi','Hall','published','${t2}');`);
await db.exec(`reset role; set role anon; reset request.jwt.claim.sub;`);
const pub = await q(`select title from public.events`);
ok(pub.length === 1 && pub[0].title === "Summit",
   `anon sees the default tenant published event and only that (${pub.map((r) => r.title).join(", ") || "none"})`);
console.log("     (and that is the limitation: the public website can only serve the");
console.log("      default tenant until a request carries which tenant it is for)");

// ── What Stage 4 does NOT close, measured rather than described ──
//
// A SECURITY DEFINER function bypasses RLS, so the isolation policies above do
// not apply inside one. Two tenants finally exist, so this can be demonstrated
// instead of asserted from the architecture document. Reported rather than
// asserted: it is known debt that Stage 5 pays off, and a passing assertion
// here would be claiming a leak is correct.
console.log("\nThe definer functions are still a hole (this is Stage 5 debt):");
// A risk in each business. risks is tenant-owned, unlike users, which is
// global by design and so proves nothing either way.
await owner();
await db.exec(`delete from public.risks;`);
await db.exec(`insert into public.risks(code,risk,area,impact,likelihood,next_review,tenant_id)
               values ('R-01','Ada venue','Events',5,5,current_date - 30,'${t1}');`);
await db.exec(`insert into public.risks(code,risk,area,impact,likelihood,next_review,tenant_id)
               values ('R-01','Ben venue','Events',5,5,current_date - 30,'${t2}');`);
// The demonstration has moved three times, because each batch of Stage 5
// fixes the function it was using: bos_govern_attention in 0038,
// bos_section_status in 0039, bos_can_see_task in 0040. It now uses a Group C
// mutator, and the example is a cross-tenant WRITE rather than a read.
await owner();
await db.exec(`delete from public.promo_codes;`);
await db.exec(`insert into public.promo_codes(code,percent_off,active,uses,tenant_id) values
  ('LAUNCH50',50,true,0,'${t1}'), ('LAUNCH50',10,true,0,'${t2}');`);
await as(BEN);
const redeemed = await tryExec(`select public.redeem_promo('LAUNCH50')`);
await owner();
const uses = await q(`select percent_off, uses from public.promo_codes order by percent_off`);
console.log(`  ⚠️  Ben redeeming his own LAUNCH50 ${redeemed ? "failed: " + redeemed : "succeeded"}.`);
console.log(`  ⚠️  Uses afterwards: ${uses.map((r) => `${r.percent_off}%→${r.uses}`).join(", ")}.`);
console.log(`      redeem_promo matches on the code alone, so it reaches both`);
console.log(`      businesses rows at once — a definer function bypasses RLS and the`);
console.log(`      policy never runs inside it. Groups A, B and E are closed; C and`);
console.log(`      D remain, 40 functions, and only their bodies can close them.`);

console.log("\nEvery tenant-owned table carries the policy, not just the ones tested:");
await owner();
const manifest = JSON.parse((await import("fs")).readFileSync("supabase/tenancy/tables.json", "utf8"));
const covered = new Set((await q(
  `select tablename from pg_policies where policyname='tenant isolation' and permissive='RESTRICTIVE'`
)).map((r) => r.tablename));
const uncovered = manifest.tenant.filter((t) => !covered.has(t));
ok(uncovered.length === 0,
   uncovered.length === 0
     ? `all ${manifest.tenant.length} tenant-owned tables are isolated`
     : `NOT ISOLATED: ${uncovered.join(", ")}`);

console.log("\nThe tenancy tables are deliberately not isolated this way:");
ok(!covered.has("tenant_members"),
   "tenant_members has no isolation policy — reading your memberships across tenants is how switching works, and restricting it to one tenant would make it impossible");

console.log("\nClearing the default flag cannot take the product dark:");
await owner();
await db.exec(`update public.tenants set is_default=false where id='${t1}';`);
await db.exec(`update public.tenants set status='archived' where id='${t2}';`);
await as(ADA);
ok((await one(`select public.bos_request_tenant() t`)).t === t1,
   "with no default and one active tenant left, the request still resolves — membership answers first anyway");
await owner();
await db.exec(`reset role; set role anon; reset request.jwt.claim.sub;`);
ok((await one(`select public.bos_request_tenant() t`)).t === t1,
   "and so does an anonymous one, from the sole-active-tenant fallback");

console.log(`\n${state.pass} passed, ${state.fail} failed`);
process.exit(state.fail ? 1 : 0);
