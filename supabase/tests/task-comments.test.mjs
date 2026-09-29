// Verifies the task comment thread: staff can read and post, an author can
// edit only their own, and deleting a task takes its thread with it.
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
for (const f of ["schema.sql","migrations/0007_business_os.sql","migrations/0008_business_os_registries.sql","migrations/0009_business_os_reviews.sql","migrations/0010_business_os_coverage.sql","migrations/0011_business_os_chain.sql","migrations/0012_fix_dashboard_summary.sql","migrations/0015_task_comments.sql"]) await db.exec(strip(fs.readFileSync("supabase/"+f,"utf8")));
await db.exec(`grant usage on schema public to anon, authenticated;
  grant select, insert, update, delete on all tables in schema public to anon, authenticated;
  grant execute on all functions in schema public to anon, authenticated;`);

let pass=0,fail=0; const ok=(c,m)=>{c?(pass++,console.log("  ✅ "+m)):(fail++,console.log("  ❌ "+m));};
const q=async s=>(await db.query(s)).rows;
const n=async s=>Number((await q(s))[0].c);
const A="11111111-1111-1111-1111-111111111111", B="22222222-2222-2222-2222-222222222222", C="33333333-3333-3333-3333-333333333333";
await db.exec(`insert into auth.users(id,email) values ('${A}','admin@t.c'),('${B}','staff@t.c'),('${C}','member@t.c');`);
await db.exec(`update public.users set primary_role='admin' where id='${A}';`);
await db.exec(`update public.users set primary_role='employee' where id='${B}';`);
await db.exec(`insert into public.tasks(code,title) values ('X-1','A task');`);
const tid=(await q(`select id from public.tasks where code='X-1'`))[0].id;
const as=(u)=>db.exec(`set role authenticated; set request.jwt.claim.sub='${u}';`);
const owner=()=>db.exec(`reset role; set request.jwt.claim.sub='';`);

console.log("\nPosting:");
await as(A);
await db.exec(`insert into public.task_comments(task_id,author_id,body) values ('${tid}','${A}','Admin note');`);
ok(true,"admin posts a comment");
await as(B);
await db.exec(`insert into public.task_comments(task_id,author_id,body) values ('${tid}','${B}','Staff note');`);
ok(true,"staff posts a comment");
ok(await n(`select count(*)::int c from public.task_comments`)===2,"both are stored");

console.log("\nGuards:");
let blocked=false;
try { await db.exec(`insert into public.task_comments(task_id,author_id,body) values ('${tid}','${A}','Forged');`); }
catch { blocked=true; }
ok(blocked,"staff cannot post as somebody else");
blocked=false;
try { await db.exec(`insert into public.task_comments(task_id,author_id,body) values ('${tid}','${B}','   ');`); }
catch { blocked=true; }
ok(blocked,"an empty comment is rejected");
await as(C);
ok(await n(`select count(*)::int c from public.task_comments`)===0,"a plain member sees none");
blocked=false;
try { await db.exec(`insert into public.task_comments(task_id,author_id,body) values ('${tid}','${C}','Outsider');`); }
catch { blocked=true; }
ok(blocked,"a plain member cannot post");

console.log("\nEditing:");
await as(B);
await db.exec(`update public.task_comments set body='Staff note, revised' where author_id='${B}';`);
ok((await q(`select body from public.task_comments where author_id='${B}'`))[0].body==="Staff note, revised","author edits their own");
await db.exec(`update public.task_comments set body='hijacked' where author_id='${A}';`);
ok(await n(`select count(*)::int c from public.task_comments where body='hijacked'`)===0,"but cannot edit another author's");

console.log("\nCascade:");
await owner();
await db.exec(`delete from public.tasks where id='${tid}';`);
ok(await n(`select count(*)::int c from public.task_comments`)===0,"deleting the task removes its thread");

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail?1:0);
