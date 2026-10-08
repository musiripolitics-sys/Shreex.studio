/**
 * Every workflow, end to end, in one pass.
 *
 * This walks the path a real platform operator walks — create a business, hand
 * it to somebody, that person joins, plans a week, works it, closes it — and
 * checks isolation holds at every step. The per-feature suites prove each piece
 * in isolation; this proves they compose, which is where the bugs that reach a
 * user actually live.
 *
 * Run as the people involved, never as the owner, except where a step is
 * explicitly checking what the owner can see.
 */
import { freshDb, counter } from "./_db.mjs";

const { state, ok } = counter();
const { db, skipped } = await freshDb();
ok(skipped.length === 0, `every migration applied cleanly (${skipped.length} failures)`);

const q = async (s) => (await db.query(s)).rows;
const one = async (s) => (await q(s))[0];
const attempt = async (s) => { try { return { v: await one(s) }; } catch (e) { return { e: e.message.split("\n")[0] }; } };
const as = (u) => db.exec(`set role authenticated; set request.jwt.claim.sub='${u}'; set request.jwt.claim.role='authenticated'; reset request.jwt.claim.tenant_id;`);
const owner = () => db.exec(`reset role; reset request.jwt.claim.sub; reset request.jwt.claim.role; reset request.jwt.claim.tenant_id;`);
const n = (v) => Number(v);

const SUP = "11111111-1111-1111-1111-111111111111"; // platform
const BOSS = "22222222-2222-2222-2222-222222222222"; // will run the business
const STAFF = "33333333-3333-3333-3333-333333333333"; // does the work
const OTHER = "44444444-4444-4444-4444-444444444444"; // another business entirely
await db.exec(`insert into auth.users(id,email) values
  ('${SUP}','platform@shreex.test'),('${BOSS}','boss@jiloo.test'),
  ('${STAFF}','staff@jiloo.test'),('${OTHER}','rival@other.test');`);
await db.exec(`insert into public.platform_admins(user_id,role) values ('${SUP}','super_admin') on conflict do nothing;`);
await db.exec(`delete from public.tenant_members where user_id in ('${BOSS}','${STAFF}','${OTHER}');`);

/* ── 1. The platform operator sets a business up ─────────────── */
console.log("\n1. A business is created, with its products and its administrator:");
await as(SUP);
let r = await attempt(`select public.bos_create_tenant(
  'Jiloo Dope Designs','jiloo',
  '{"website":"https://jiloo.test","city":"Chennai","industry":"Design","employee_count":"9"}'::jsonb,
  array['plan','events','money','marketing'],
  'boss@jiloo.test') v`);
ok(!r.e, `created (${r.e ?? "ok"})`);
const jiloo = r.v?.v?.tenant_id;
ok(r.v?.v?.admin === "appointed", `its administrator was appointed, not left to the creator (${r.v?.v?.admin})`);
ok(n(r.v?.v?.seeded?.workstreams) === 12, `and it opens with a roadmap spine (${r.v?.v?.seeded?.workstreams} workstreams)`);
await owner();
ok(n((await one(`select count(*) c from public.tenant_products where tenant_id='${jiloo}' and is_enabled`)).c) === 4,
   "with exactly the four products chosen, not all nine");
ok(n((await one(`select count(*) c from public.tenant_members where tenant_id='${jiloo}' and user_id='${SUP}'`)).c) === 0,
   "and the platform operator is NOT a member of it");

/* ── 2. Somebody with no account is invited ──────────────────── */
console.log("\n2. A second person, who has no account yet, is invited:");
await as(SUP);
r = await attempt(`select public.bos_invite_to_tenant_by_id('${jiloo}','newhire@jiloo.test','employee') v`);
ok(!r.e, `invited without entering the business (${r.e ?? "ok"})`);
const token = r.v?.v;
await owner();
ok(n((await one(`select count(*) c from public.tenant_members m join public.users u on u.id=m.user_id
                  where m.tenant_id='${jiloo}' and lower(u.email)='newhire@jiloo.test'`)).c) === 0,
   "an invitation is not a membership — nobody joined yet");

console.log("\n   and the invitation is to an ADDRESS, not to whoever holds the link:");
await as(OTHER);
r = await attempt(`select public.bos_accept_invitation('${token}') v`);
ok(!!r.e && r.e.includes("WRONG_ACCOUNT"), `a forwarded link does not hand over the seat (${r.e ?? "ACCEPTED"})`);

/* ── 3. The administrator runs their business ────────────────── */
console.log("\n3. The administrator takes over, and the platform operator is not involved:");
await as(BOSS);
ok((await one(`select public.is_admin() v`)).v === true, "the appointed admin is an admin of it");
r = await attempt(`select public.bos_invite_to_tenant('staff@jiloo.test','employee',array['plan']) v`);
ok(!r.e, `and can invite their own staff from inside (${r.e ?? "ok"})`);
const staffToken = r.v?.v;
await as(STAFF);
r = await attempt(`select public.bos_accept_invitation('${staffToken}') v`);
ok(!r.e, `who accepts and joins (${r.e ?? "ok"})`);
ok((await one(`select public.bos_is_staff() v`)).v === true, "and is staff in it");
ok((await one(`select public.is_admin() v`)).v === false, "but not an admin");

/* ── 4. The week ─────────────────────────────────────────────── */
console.log("\n4. Staff plan and work the week:");
await as(STAFF);
r = await attempt(`select public.bos_ensure_sprint() v`);
ok(!r.e, `staff can start the sprint, not just admins (${r.e ?? "ok"})`);
const sprint = r.v?.v;
await owner();
const wsId = (await one(`select id from public.workstreams where tenant_id='${jiloo}' limit 1`)).id;
await db.exec(`insert into public.goals(code,objective,workstream_id,status,tenant_id)
               values ('G-1','Launch the autumn collection','${wsId}','in_progress','${jiloo}');`);
const goal = (await one(`select id from public.goals where tenant_id='${jiloo}'`)).id;
await db.exec(`insert into public.tasks(code,title,status,estimate_hours,actual_hours,sprint_id,goal_id,tenant_id) values
  ('T-1','Shoot the lookbook','completed',8,9,'${sprint}','${goal}','${jiloo}'),
  ('T-2','Write the copy','completed',4,3,'${sprint}','${goal}','${jiloo}'),
  ('T-3','Lease legal review','blocked',6,2,'${sprint}','${goal}','${jiloo}'),
  ('T-4','Landing page','in_progress',12,7,'${sprint}','${goal}','${jiloo}'),
  ('T-5','Campaign brief','not_started',null,null,'${sprint}','${goal}','${jiloo}'),
  ('T-6','Booking flow refresh','not_started',16,null,null,'${goal}','${jiloo}');`);

await as(STAFF);
const m = (await one(`select public.bos_sprint_metrics() v`)).v;
ok(n(m.stories) === 5, `five stories committed, the backlog one excluded (${m.stories})`);
ok(n(m.committed_hours) === 30 && n(m.done_hours) === 12, `hours add up (${m.done_hours}h of ${m.committed_hours}h)`);
ok(n(m.blocked) === 1, `the blocked one is surfaced (${m.blocked})`);
ok(n(m.unestimated) === 1, `so is the unsized one (${m.unestimated}) — a burn computed from unsized work is arithmetic, not information`);
ok(n(m.overrun_hours) === 1, `and overrun is real: T-1 took 9 against 8, T-2 came in under and does not offset it (${m.overrun_hours}h)`);

console.log("\n   the backlog can be pulled in, and the retro produces an action:");
await as(STAFF);
// Read as the owner: this is test setup, and whether staff can SELECT the row
// directly is a different question from whether they may move it.
await owner();
const t6 = (await one(`select id from public.tasks where code='T-6' and tenant_id='${jiloo}'`)).id;
await as(STAFF);
r = await attempt(`select public.bos_set_task_sprint('${t6}','${sprint}') v`);
ok(!r.e, `staff pull a story they do not own into the week (${r.e ?? "ok"}) — a plain update was silently refused`);
ok(n((await one(`select (public.bos_sprint_metrics()->>'stories')::int v`)).v) === 6, "six after pulling one in");
r = await attempt(`insert into public.sprint_notes(sprint_id,kind,body,tenant_id)
                   values ('${sprint}','retro_action','Split anything over 8h at refinement','${jiloo}') returning id v`);
ok(!r.e, `staff can record a retro action (${r.e ?? "ok"})`);

console.log("\n   closing the week is admin, and carries the unfinished forward:");
await as(STAFF);
r = await attempt(`select public.bos_close_sprint() v`);
ok(!!r.e && r.e.includes("FORBIDDEN"), `staff cannot close it (${r.e ?? "CLOSED"}) — it moves everybody else's work`);
await as(BOSS);
r = await attempt(`select public.bos_close_sprint() v`);
ok(!r.e, `the admin can (${r.e ?? "ok"})`);
ok(n(r.v?.v?.carried_out) === 4, `four unfinished carried (${r.v?.v?.carried_out}): blocked, in progress and two not started`);
await owner();
ok(n((await one(`select carried_out from public.sprints where id='${sprint}'`)).carried_out) === 4,
   "and the count is recorded on the sprint that ended, so it survives those stories moving");

/* ── 5. Isolation, throughout ────────────────────────────────── */
console.log("\n5. None of it is visible to another business:");
await owner();
const t1 = (await one(`select id from public.tenants where is_default`)).id;
await db.exec(`insert into public.tenant_members(tenant_id,user_id,role,status)
               values ('${t1}','${OTHER}','admin','active') on conflict (tenant_id,user_id) do update set role='admin';`);
await as(OTHER);
ok((await q(`select id from public.tasks`)).length === 0, "an admin of another business sees none of the stories");
ok((await q(`select id from public.sprints`)).length === 0, "nor the sprint");
ok((await q(`select id from public.sprint_notes`)).length === 0, "nor the retro");
ok((await q(`select id from public.goals`)).length === 0, "nor the goals");
ok((await q(`select slug from public.bos_my_tenants()`)).every((x) => x.slug !== "jiloo"),
   "and cannot switch into it");
r = await attempt(`select public.bos_assign_tenant_admin('${jiloo}','rival@other.test') v`);
ok(!!r.e && r.e.includes("NOT_SUPER_ADMIN"), `nor appoint themselves into it (${r.e ?? "APPOINTED"})`);

console.log("\n   while the platform operator can enter it, and that is logged:");
await as(SUP);
r = await attempt(`select public.bos_switch_tenant('${jiloo}') v`);
ok(!r.e, `entered (${r.e ?? "ok"})`);
ok((await q(`select code from public.tasks order by code`)).length === 6, "and now sees the six stories");
await owner();
ok(n((await one(`select count(*) c from public.audit_log where action='enter' and tenant_id='${jiloo}'`)).c) === 1,
   "with one entry row in that business's own log");

console.log(`\n${state.pass} passed, ${state.fail} failed`);
process.exit(state.fail ? 1 : 0);
