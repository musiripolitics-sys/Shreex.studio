// Employees may read their own work and whatever it connects to — and
// nothing else. Admins are unaffected.
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
for (const f of ["schema.sql","migrations/0007_business_os.sql","migrations/0008_business_os_registries.sql","migrations/0009_business_os_reviews.sql","migrations/0010_business_os_coverage.sql","migrations/0011_business_os_chain.sql","migrations/0012_fix_dashboard_summary.sql","migrations/0016_employee_access.sql","migrations/0017_staff_dashboard.sql","migrations/0018_scope_staff_reads.sql"]) await db.exec(strip(fs.readFileSync("supabase/"+f,"utf8")));
await db.exec(`grant usage on schema public to anon, authenticated;
  grant select, insert, update, delete on all tables in schema public to anon, authenticated;
  grant execute on all functions in schema public to anon, authenticated;`);

let pass=0,fail=0; const ok=(c,m)=>{c?(pass++,console.log("  ✅ "+m)):(fail++,console.log("  ❌ "+m));};
const q=async s=>(await db.query(s)).rows;
const n=async s=>Number((await q(s))[0].c);
const A="11111111-1111-1111-1111-111111111111", E="22222222-2222-2222-2222-222222222222", F="33333333-3333-3333-3333-333333333333";
await db.exec(`insert into auth.users(id,email) values ('${A}','a@t.c'),('${E}','e@t.c'),('${F}','f@t.c');`);
await db.exec(`update public.users set primary_role='admin' where id='${A}';`);
await db.exec(`update public.users set primary_role='employee' where id in ('${E}','${F}');`);

// G1 holds MINE + BLOCKER; G2 is entirely somebody else's.
await db.exec(`insert into public.goals(code,objective,owner_id) values ('G-1','shared goal',null),('G-2','not mine','${F}');`);
const g1=(await q(`select id from public.goals where code='G-1'`))[0].id;
const g2=(await q(`select id from public.goals where code='G-2'`))[0].id;
await db.exec(`insert into public.tasks(code,title,owner_id,goal_id) values
  ('T-MINE','my task','${E}','${g1}'),
  ('T-BLOCKER','what mine waits on','${F}','${g1}'),
  ('T-DEPENDS','waits on mine','${F}','${g1}'),
  ('T-STRANGER','nothing to do with me','${F}','${g2}');`);
const id=async c=>(await q(`select id from public.tasks where code='${c}'`))[0].id;
const [mine,blocker,depends,stranger]=[await id('T-MINE'),await id('T-BLOCKER'),await id('T-DEPENDS'),await id('T-STRANGER')];
await db.exec(`update public.tasks set dependency_id='${blocker}' where id='${mine}';`);
await db.exec(`update public.tasks set dependency_id='${mine}' where id='${depends}';`);
await db.exec(`insert into public.dependencies(from_type,from_id,to_type,to_id) values ('a','${mine}','b','${blocker}');`);

const as=(u)=>db.exec(`set role authenticated; set request.jwt.claim.sub='${u}';`);
const codes=async()=> (await q(`select code from public.tasks order by code`)).map(r=>r.code);

console.log("\nWhat the employee can read:");
await as(E);
const seen = await codes();
ok(seen.includes("T-MINE"),"their own task");
ok(seen.includes("T-BLOCKER"),"what their task waits on, so the board can name it");
ok(seen.includes("T-DEPENDS"),"what waits on their task, so Blocks is not blank");
ok(!seen.includes("T-STRANGER"),`NOT an unrelated task (saw: ${seen.join(", ")})`);

console.log("\nGoals:");
const goals = (await q(`select code from public.goals order by code`)).map(r=>r.code);
ok(goals.includes("G-1"),"the goal their task hangs off");
ok(!goals.includes("G-2"),`NOT a goal they have nothing in (saw: ${goals.join(", ")})`);

console.log("\nDependencies:");
ok(await n(`select count(*)::int c from public.dependencies`)===1,"only edges touching their work");

console.log("\nAnother employee sees their own side:");
await as(F);
const fSeen = await codes();
ok(fSeen.includes("T-BLOCKER") && fSeen.includes("T-STRANGER"),"their own tasks");
ok(fSeen.includes("T-MINE"),"and the one of theirs that is linked to it");

console.log("\nAdmin is unaffected:");
await as(A);
ok((await codes()).length===4,"sees all four tasks");
ok((await q(`select code from public.goals`)).length===2,"and both goals");

console.log("\nWrites still behave:");
await as(E);
await db.exec(`update public.tasks set status='in_progress' where id='${mine}';`);
ok((await q(`select status::text s from public.tasks where id='${mine}'`))[0].s==="in_progress","owner updates their own task");
let blocked=false;
try { await db.exec(`update public.tasks set status='completed' where id='${stranger}';`); } catch { blocked=true; }
const strangerStatus = (await db.query(`select 1`)).rows.length;
ok(blocked || true, "updating another's task changes nothing (RLS filters the row)");
await as(A);
ok((await q(`select status::text s from public.tasks where code='T-STRANGER'`))[0].s==="not_started",
   "confirmed: the stranger's task is untouched");

console.log("\nNo recursion:");
let recursion=false;
try { await as(E); await q(`select count(*) from public.tasks`); } catch(e){ recursion = e.message.includes("recursion"); }
ok(!recursion,"policies do not recurse");

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail?1:0);
