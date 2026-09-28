// Verifies migration 0011: task time tracking, per-task reviews, roadmap→task
// generation and the section-status RPC — executed on real Postgres.
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const db = new PGlite(); await db.waitReady;
await db.exec(`
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text,
  raw_user_meta_data jsonb, raw_app_meta_data jsonb, encrypted_password text,
  email_confirmed_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $fn$;
create or replace function auth.role() returns text language sql stable as $fn$
  select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'anon') $fn$;
create role authenticated; create role anon; create role service_role;
create or replace function gen_random_bytes(n int) returns bytea language sql as $fn$ select decode(md5(random()::text),'hex') $fn$;
create or replace function crypt(a text,b text) returns text language sql as $fn$ select a $fn$;
create or replace function gen_salt(a text) returns text language sql as $fn$ select 'x' $fn$;
create domain citext as text;`);

const strip = (s) => s.replace(/create extension if not exists (pgcrypto|citext);/g, "");
const files = ["schema.sql", "migrations/0007_business_os.sql", "migrations/0008_business_os_registries.sql",
  "migrations/0009_business_os_reviews.sql", "migrations/0010_business_os_coverage.sql",
  "migrations/0011_business_os_chain.sql"];

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  ✅ " + m)) : (fail++, console.log("  ❌ " + m)); };
const q = async (s) => (await db.query(s)).rows;

console.log("\nMigrations apply:");
for (const f of files) {
  try { await db.exec(strip(fs.readFileSync(`supabase/${f}`, "utf8"))); ok(true, f); }
  catch (e) { ok(false, `${f} — ${e.message}`); console.log("\n" + pass + " passed, " + fail + " failed"); process.exit(1); }
}

// 0011 is meant to be re-runnable.
await db.exec(strip(fs.readFileSync("supabase/migrations/0011_business_os_chain.sql", "utf8")));
ok(true, "0011 is idempotent (applied twice)");

const A = "11111111-1111-1111-1111-111111111111";
await db.exec(`insert into auth.users(id,email) values ('${A}','admin@t.c');`);
await db.exec(`update public.users set primary_role='admin', full_name='Admin' where id='${A}';`);
await db.exec(`set request.jwt.claim.sub = '${A}';`);

console.log("\nRoadmap → tasks:");
await db.exec(`insert into public.workstreams(key,name) values ('ops','Ops') on conflict do nothing;`);
await db.exec(`
  insert into public.goals(code,objective,deliverable,owner_id,start_date,end_date,priority,status,
    workstream_id)
  select 'G1','Ship checkout','Razorpay live','${A}','2026-09-01','2026-09-20','high','in_progress', w.id
    from public.workstreams w where w.key='ops';
  insert into public.goals(code,objective,deliverable,owner_id,start_date,end_date,status)
  values ('G2','Hire designer',null,'${A}','2026-10-01','2026-12-01','not_started');`);

const made = (await q(`select public.bos_sync_roadmap_tasks() n`))[0].n;
ok(made === 2, `generates one task per goal (got ${made})`);
const t = await q(`select t.title, t.description, t.due_date, t.status::text, t.goal_id, g.code
                     from public.tasks t join public.goals g on g.id=t.goal_id order by g.code`);
ok(t[0].title === "Razorpay live", "uses the deliverable as the task title");
ok(t[0].description === "Ship checkout", "and keeps the objective as the description");
ok(t[1].title === "Hire designer", "falls back to the objective when there is no deliverable");
ok(new Date(t[0].due_date).toISOString().startsWith("2026-09-20"),
   "carries the goal end date onto the task due date");
ok(t[0].status === "in_progress", "carries the goal status across");
ok((await q(`select public.bos_sync_roadmap_tasks() n`))[0].n === 0, "re-running creates no duplicates");

console.log("\nDependencies mirror onto tasks:");
await db.exec(`update public.goals set dependency_id=(select id from public.goals where code='G1') where code='G2';`);
await db.exec(`select public.bos_sync_roadmap_tasks();`);
const dep = await q(`select d.title from public.tasks t join public.tasks d on d.id=t.dependency_id
                      join public.goals g on g.id=t.goal_id where g.code='G2'`);
ok(dep.length === 1 && dep[0].title === "Razorpay live", "G2's task depends on G1's task");

console.log("\nCompletion stamps and opens a review:");
const tid = (await q(`select t.id from public.tasks t join public.goals g on g.id=t.goal_id where g.code='G1'`))[0].id;
await db.exec(`update public.tasks set estimate_hours=8 where id='${tid}';`);
ok((await q(`select count(*)::int c from public.task_reviews where task_id='${tid}'`))[0].c === 0,
   "no review while the task is unfinished");
await db.exec(`update public.tasks set status='completed' where id='${tid}';`);
const done = (await q(`select completed_at from public.tasks where id='${tid}'`))[0];
ok(done.completed_at !== null, "completed_at is stamped on completion");
const rev = (await q(`select outcome, estimate_hours, reviewed_at from public.task_reviews where task_id='${tid}'`))[0];
ok(rev !== undefined, "completing a task opens its review");
ok(rev?.outcome === "pending", "the review starts pending, so it shows as outstanding");
ok(Number(rev?.estimate_hours) === 8, "the review snapshots the 8h estimate");
ok(rev?.reviewed_at === null, "and is not marked reviewed until someone fills it in");

console.log("\nVariance:");
await db.exec(`update public.task_reviews set actual_hours=11, outcome='met' where task_id='${tid}';`);
ok(Number((await q(`select variance_hours v from public.task_reviews where task_id='${tid}'`))[0].v) === 3,
   "variance_hours computes actual − estimate (11 − 8 = 3)");

console.log("\nReopening:");
await db.exec(`update public.tasks set status='in_progress' where id='${tid}';`);
ok((await q(`select completed_at from public.tasks where id='${tid}'`))[0].completed_at === null,
   "reopening a task clears completed_at");
ok((await q(`select count(*)::int c from public.task_reviews where task_id='${tid}'`))[0].c === 1,
   "but keeps the review already written");
await db.exec(`update public.tasks set status='completed' where id='${tid}';`);
ok(Number((await q(`select actual_hours a from public.task_reviews where task_id='${tid}'`))[0].a) === 11,
   "re-completing does not wipe the recorded actual hours");

console.log("\nSection status RPC:");
const st = (await q(`select public.bos_section_status() s`))[0].s;
ok(typeof st === "object" && st !== null, "returns an object");
ok(st.roadmap?.total === 2, `roadmap counts both goals (got ${st.roadmap?.total})`);
ok(st.tasks?.total === 2, "tasks counts both generated tasks");
ok(st.tasks?.open === 1, "one task is still open (the other is completed)");
ok(st.task_reviews?.overdue === 0, "no pending reviews once the one review is filled in");
ok(st.feedback?.total === 0, "an untouched section reports zero rather than erroring");
ok("legal" in st && "sops" in st && "vendors" in st, "covers the registry sections too");

console.log("\nOverdue detection:");
await db.exec(`update public.goals set end_date = current_date - 5 where code='G2';
               update public.tasks set due_date = current_date - 5, status='in_progress'
                 where goal_id=(select id from public.goals where code='G2');`);
const st2 = (await q(`select public.bos_section_status() s`))[0].s;
ok(st2.tasks?.overdue === 1, `a past-due open task is overdue (got ${st2.tasks?.overdue})`);
// G1 ended 2026-09-20 and G2 was just backdated, so both goals are now past due.
ok(st2.roadmap?.overdue === 2, `past-due open goals are overdue (got ${st2.roadmap?.overdue})`);
await db.exec(`update public.tasks set status='completed' where goal_id=(select id from public.goals where code='G2');`);
const st3 = (await q(`select public.bos_section_status() s`))[0].s;
ok(st3.tasks?.overdue === 0, "completing it clears the overdue count");
ok(st3.task_reviews?.overdue === 1, "and its fresh pending review becomes outstanding work");

console.log("\nAccess control:");
const B = "22222222-2222-2222-2222-222222222222";
await db.exec(`insert into auth.users(id,email) values ('${B}','member@t.c');`);
await db.exec(`set request.jwt.claim.sub = '${B}';`);
for (const [fn, label] of [["bos_section_status()", "bos_section_status"], ["bos_sync_roadmap_tasks()", "bos_sync_roadmap_tasks"]]) {
  let raised = false;
  try { await db.query(`select public.${fn}`); } catch { raised = true; }
  ok(raised, `${label} refuses a non-admin`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
