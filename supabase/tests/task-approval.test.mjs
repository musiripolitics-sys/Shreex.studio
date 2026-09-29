// A task is not finished because the person doing it says so.
// Assignee, a comment, and an admin approval — in that order.
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
for (const f of ["schema.sql","migrations/0007_business_os.sql","migrations/0008_business_os_registries.sql","migrations/0009_business_os_reviews.sql","migrations/0010_business_os_coverage.sql","migrations/0011_business_os_chain.sql","migrations/0012_fix_dashboard_summary.sql","migrations/0015_task_comments.sql","migrations/0016_employee_access.sql","migrations/0017_staff_dashboard.sql","migrations/0018_scope_staff_reads.sql","migrations/0019_plan_section.sql","migrations/0020_task_approval.sql"]) await db.exec(strip(fs.readFileSync("supabase/"+f,"utf8")));
await db.exec(`alter table public.users enable row level security;`);
await db.exec(`grant usage on schema public to anon, authenticated;
  grant select, insert, update, delete on all tables in schema public to anon, authenticated;
  grant execute on all functions in schema public to anon, authenticated;`);

let pass=0,fail=0; const ok=(c,m)=>{c?(pass++,console.log("  ✅ "+m)):(fail++,console.log("  ❌ "+m));};
const q=async s=>(await db.query(s)).rows;
const one=async s=>(await q(s))[0];
// Run a statement and report the error message, or null when it succeeded.
const tryExec=async s=>{ try { await db.exec(s); return null; } catch(e){ return e.message; } };

const A="11111111-1111-1111-1111-111111111111", E="22222222-2222-2222-2222-222222222222";
await db.exec(`insert into auth.users(id,email) values ('${A}','a@t.c'),('${E}','e@t.c');`);
await db.exec(`update public.users set primary_role='admin', full_name='Ada' where id='${A}';`);
await db.exec(`update public.users set primary_role='employee', full_name='Priya' where id='${E}';`);
await db.exec(`insert into public.employee_module_access(user_id,section) values ('${E}','plan');`);

await db.exec(`insert into public.tasks(code,title,owner_id,status) values
  ('T-1','assigned to Priya','${E}','in_progress'),
  ('T-2','nobody owns this',null,'in_progress');`);
const id=async c=>(await one(`select id from public.tasks where code='${c}'`)).id;
const [t1,t2]=[await id('T-1'),await id('T-2')];
const as=u=>db.exec(`set role authenticated; set request.jwt.claim.sub='${u}';`);
const state=async t=>(await one(`select status::text s, approval_state::text a from public.tasks where id='${t}'`));

console.log("\nThe two things a task needs before it can even be submitted:");
await as(E);
let err=await tryExec(`update public.tasks set approval_state='pending' where id='${t1}'`);
ok(/comment/i.test(err??""),`no comment, so it cannot be submitted (${(err??"NO ERROR").split("\n")[0].slice(0,60)})`);

await db.exec(`insert into public.task_comments(task_id,author_id,body) values ('${t1}','${E}','Did the thing. Evidence in the thread.');`);
err=await tryExec(`update public.tasks set approval_state='pending' where id='${t1}'`);
ok(err===null,"with a comment, it submits");
ok((await state(t1)).a==='pending',"and sits at pending");
ok((await one(`select submitted_by from public.tasks where id='${t1}'`)).submitted_by===E,"stamped with who submitted it");

console.log("\nAn unassigned task:");
await as(A);
await db.exec(`insert into public.task_comments(task_id,author_id,body) values ('${t2}','${A}','note');`);
err=await tryExec(`update public.tasks set status='completed' where id='${t2}'`);
ok(/[Aa]ssign/.test(err??""),`cannot be completed even by an admin (${(err??"NO ERROR").split("\n")[0].slice(0,60)})`);

console.log("\nAn employee cannot wave their own work through:");
await as(E);
err=await tryExec(`update public.tasks set approval_state='approved' where id='${t1}'`);
ok(/admin/i.test(err??""),`approving is refused (${(err??"NO ERROR").split("\n")[0].slice(0,50)})`);
err=await tryExec(`update public.tasks set status='completed' where id='${t1}'`);
ok(/approve/i.test(err??""),`and so is completing (${(err??"NO ERROR").split("\n")[0].slice(0,50)})`);
ok((await state(t1)).s==='in_progress',"the task is untouched");

console.log("\nThe approvals inbox:");
const inbox=await q(`select request_type, request_title, decision::text d from public.approvals where related_type='task'`);
ok(inbox.length===1 && inbox[0].d==='pending',`a pending request appeared (${inbox.map(r=>r.request_title).join()})`);

console.log("\nAn admin approves:");
await as(A);
err=await tryExec(`update public.tasks set approval_state='approved' where id='${t1}'`);
ok(err===null,"the approval goes through");
err=await tryExec(`update public.tasks set status='completed' where id='${t1}'`);
ok(err===null,"and now it completes");
const s1=await state(t1);
ok(s1.s==='completed' && s1.a==='approved',"completed and approved");
ok((await one(`select completed_at from public.tasks where id='${t1}'`)).completed_at!==null,"completed_at stamped by the 0011 trigger");
ok((await one(`select decision::text d from public.approvals where related_type='task' and related_id='${t1}'`)).d==='approved',"and the inbox row is closed out");

console.log("\nAn admin completing directly is the approval:");
await db.exec(`insert into public.tasks(code,title,owner_id,status) values ('T-3','admin does it','${A}','in_progress');`);
const t3=await id('T-3');
await db.exec(`insert into public.task_comments(task_id,author_id,body) values ('${t3}','${A}','done');`);
err=await tryExec(`update public.tasks set status='completed' where id='${t3}'`);
ok(err===null,"no request to file with themselves");
ok((await state(t3)).a==='approved',"the approval is recorded automatically");

console.log("\nSending work back:");
await db.exec(`insert into public.tasks(code,title,owner_id,status) values ('T-4','sent back','${E}','in_progress');`);
const t4=await id('T-4');
// The comment policy ties author_id to the caller, so Priya leaves her own.
await as(E);
await db.exec(`insert into public.task_comments(task_id,author_id,body) values ('${t4}','${E}','ready');`);
await db.exec(`update public.tasks set approval_state='pending' where id='${t4}'`);
await as(A); await db.exec(`update public.tasks set approval_state='rejected', decision_note='Needs the invoice attached.' where id='${t4}'`);
ok((await state(t4)).a==='rejected',"the admin can reject");
ok((await state(t4)).s==='in_progress',"and the work is open again");
await as(E);
err=await tryExec(`update public.tasks set approval_state='pending' where id='${t4}'`);
ok(err===null,"a rejected task can be resubmitted");

console.log("\nWork finished before any of this existed:");
ok(await (async()=>{const r=await one(`select count(*)::int c from public.tasks where status='completed' and approval_state<>'approved'`);return Number(r.c)===0;})(),
   "no completed task was left in a state its next edit would refuse");

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail?1:0);
