// The Plan section (Roadmap, Tasks, Dependencies, Calendar, Reviews) as the
// two people who use it actually see it. Every query below is copied from the
// page that issues it, so a pass here is a statement about the page.
import { PGlite } from "@electric-sql/pglite"; import fs from "fs";
const db=new PGlite(); await db.waitReady;
await db.exec(`create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb, raw_app_meta_data jsonb, encrypted_password text, email_confirmed_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
create or replace function auth.uid() returns uuid language sql stable as $fn$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $fn$;
create or replace function auth.role() returns text language sql stable as $fn$ select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'anon') $fn$;
create role authenticated; create role anon; create role service_role;
create or replace function gen_random_bytes(n int) returns bytea language sql as $fn$ select decode(md5(random()::text),'hex') $fn$;
create or replace function crypt(a text,b text) returns text language sql as $fn$ select a $fn$;
create or replace function gen_salt(a text) returns text language sql as $fn$ select 'x' $fn$;
create domain citext as text;`);
const strip=s=>s.replace(/create extension if not exists (pgcrypto|citext);/g,"");
const FILES=["schema.sql","migrations/0007_business_os.sql","migrations/0008_business_os_registries.sql","migrations/0009_business_os_reviews.sql","migrations/0010_business_os_coverage.sql","migrations/0011_business_os_chain.sql","migrations/0012_fix_dashboard_summary.sql","migrations/0015_task_comments.sql","migrations/0016_employee_access.sql","migrations/0017_staff_dashboard.sql","migrations/0018_scope_staff_reads.sql"];
if (fs.existsSync("supabase/migrations/0019_plan_section.sql")) FILES.push("migrations/0019_plan_section.sql");
for (const f of FILES) await db.exec(strip(fs.readFileSync("supabase/"+f,"utf8")));
// supabase/schema.sql is a stale dump: it carries the users policies but never
// runs `enable row level security` on the table, so those policies are inert in
// the fixture and any assertion about user visibility would measure nothing.
// 0001_init.sql:376 does enable it in production, so the fixture must too.
await db.exec(`alter table public.users enable row level security;`);
await db.exec(`grant usage on schema public to anon, authenticated;
  grant select, insert, update, delete on all tables in schema public to anon, authenticated;
  grant execute on all functions in schema public to anon, authenticated;`);

let pass=0,fail=0; const ok=(c,m)=>{c?(pass++,console.log("  ✅ "+m)):(fail++,console.log("  ❌ "+m));};
const q=async s=>(await db.query(s)).rows;
const n=async s=>Number((await q(s))[0].c);
const A="11111111-1111-1111-1111-111111111111", E="22222222-2222-2222-2222-222222222222", F="33333333-3333-3333-3333-333333333333";
await db.exec(`insert into auth.users(id,email) values ('${A}','a@t.c'),('${E}','e@t.c'),('${F}','f@t.c');`);
await db.exec(`update public.users set primary_role='admin', full_name='Ada Admin' where id='${A}';`);
await db.exec(`update public.users set primary_role='employee', full_name='Priya P' where id='${E}';`);
await db.exec(`update public.users set primary_role='employee', full_name='Farid F' where id='${F}';`);
// A member: not staff, and must never surface anywhere in the Business OS.
const M="44444444-4444-4444-4444-444444444444";
await db.exec(`insert into auth.users(id,email) values ('${M}','m@t.c');`);
await db.exec(`update public.users set primary_role='community_member', full_name='Meera M' where id='${M}';`);
// Priya may see the Plan module; that is the whole of her grant.
await db.exec(`insert into public.employee_module_access(user_id,section) values ('${E}','plan');`);

await db.exec(`insert into public.goals(code,objective,owner_id,end_date) values ('G-1','shared goal',null,current_date+10),('G-2','not mine','${F}',current_date+20);`);
const g1=(await q(`select id from public.goals where code='G-1'`))[0].id;
await db.exec(`insert into public.tasks(code,title,owner_id,goal_id,due_date,status) values
  ('T-MINE','my task','${E}','${g1}',current_date+2,'in_progress'),
  ('T-BLOCKER','what mine waits on','${F}','${g1}',current_date+1,'not_started'),
  ('T-DONE','finished by me','${E}','${g1}',current_date-5,'not_started'),
  ('T-STRANGER','nothing to do with me','${F}',null,current_date+3,'not_started');`);
const id=async c=>(await q(`select id from public.tasks where code='${c}'`))[0].id;
const [mine,blocker,done]=[await id('T-MINE'),await id('T-BLOCKER'),await id('T-DONE')];
await db.exec(`update public.tasks set dependency_id='${blocker}' where id='${mine}';`);
// Completing T-DONE opens its review via the 0011 trigger.
await db.exec(`update public.tasks set status='completed' where id='${done}';`);
await db.exec(`insert into public.expenses(category,amount,spent_on) values ('ops',5000,current_date);
  insert into public.revenue_entries(source,amount,received_on) values ('sponsor',90000,current_date);`);

const as=u=>db.exec(`set role authenticated; set request.jwt.claim.sub='${u}';`);
const reset=()=>db.exec(`reset role;`);

// ── ROADMAP page ──────────────────────────────────────────────────────────
console.log("\nRoadmap, as Priya:");
await as(E);
ok((await q(`select code from public.goals`)).map(r=>r.code).join()==="G-1","only the goal her work hangs off");
const rmTasks=(await q(`select code from public.tasks where goal_id is not null order by code`)).map(r=>r.code);
ok(!rmTasks.includes("T-STRANGER"),"the unfiltered task fetch is still closed by RLS");
ok(rmTasks.includes("T-BLOCKER"),"her blocker is readable, so the board can name it");

// ── The owner directory the roadmap uses to label those rows ──────────────
console.log("\nWho those rows are attributed to:");
const owners=await q(`select * from public.bos_user_directory() order by full_name`);
ok(owners.some(o=>o.id===F),`the blocker's owner has a name, not "—" (directory returned ${owners.length}: ${owners.map(o=>o.full_name).join(", ")||"nobody but herself"})`);
ok(owners.every(o=>o.email===null),`names only — no colleague email addresses (got ${JSON.stringify(owners.map(o=>o.email))})`);
ok(!owners.some(o=>o.primary_role==='community_member'),"and no members, who are not part of the Business OS");
// The plain table read is still shut, so the directory is the only way through.
ok((await q(`select id from public.users`)).length===1,"a direct select on users still returns only her own row");

// ── TASKS page ────────────────────────────────────────────────────────────
console.log("\nTasks, as Priya:");
const myTasks=(await q(`select code from public.tasks where owner_id='${E}' order by code`)).map(r=>r.code);
ok(myTasks.length===2 && myTasks.includes("T-MINE"),"the page's owner_id filter returns exactly her two");

// ── CALENDAR page ─────────────────────────────────────────────────────────
console.log("\nCalendar, as Priya:");
ok(await n(`select count(*)::int c from public.tasks where owner_id='${E}' and due_date is not null`)===2,"her dated tasks");
ok(await n(`select count(*)::int c from public.goals where owner_id='${E}'`)===0,"no goals of her own, so none on her grid");

// ── REVIEWS page ──────────────────────────────────────────────────────────
console.log("\nReviews, as Priya:");
const tr=await q(`select task_id from public.task_reviews`);
ok(tr.length===1 && tr[0].task_id===done,"the per-task tab shows the review her own completed task opened");
const money=await n(`select coalesce(sum(amount),0)::int c from public.revenue_entries`);
const spend=await n(`select coalesce(sum(amount),0)::int c from public.expenses`);
ok(money===0 && spend===0,`she cannot read company revenue or spend (revenue=${money}, spend=${spend})`);
ok(await n(`select count(*)::int c from public.reviews`)===0,"nor the leadership retro");
// …which is exactly why the period tab must not be offered to her.
console.log("    ↑ money is correctly unreadable — so the period tab can only render zeros");

console.log("\nWho may finish a review:");
await as(E);
await db.exec(`update public.task_reviews set outcome='met', actual_hours=4 where task_id='${done}';`);
ok((await q(`select outcome::text o from public.task_reviews where task_id='${done}'`))[0].o==='met',
   "Priya closes the review her own completed task opened");
// Farid owns no review here; give him one to try to reach.
await as(F);
await db.exec(`update public.task_reviews set outcome='missed' where task_id='${done}';`);
await as(A);
ok((await q(`select outcome::text o from public.task_reviews where task_id='${done}'`))[0].o==='met',
   "another employee's write touches nothing");

// ── ADMIN ─────────────────────────────────────────────────────────────────
console.log("\nAdmin sees the whole plan:");
await as(A);
ok((await q(`select code from public.tasks`)).length===4,"all four tasks");
ok((await q(`select code from public.goals`)).length===2,"both goals");
ok(await n(`select coalesce(sum(amount),0)::int c from public.revenue_entries`)===90000,"and the money the retro is built on");
const aOwners=await q(`select * from public.bos_user_directory()`);
ok(aOwners.length===4,`the whole directory (${aOwners.length} rows)`);
ok(aOwners.every(o=>o.email),"with emails, which only an admin gets");

// ── Section gate ──────────────────────────────────────────────────────────
console.log("\nThe gate itself:");
await as(E);
ok((await q(`select public.bos_can_access('plan') c`))[0].c===true,"Priya may open Plan");
ok((await q(`select public.bos_can_access('money') c`))[0].c===false,"but not Money");

await reset();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail?1:0);
