// A procedure is only worth having if it can say which version is current,
// who approved it, who has read it, and whether it was followed on the day.
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
for (const f of ["schema.sql","migrations/0007_business_os.sql","migrations/0008_business_os_registries.sql","migrations/0009_business_os_reviews.sql","migrations/0010_business_os_coverage.sql","migrations/0011_business_os_chain.sql","migrations/0012_fix_dashboard_summary.sql","migrations/0015_task_comments.sql","migrations/0016_employee_access.sql","migrations/0017_staff_dashboard.sql","migrations/0018_scope_staff_reads.sql","migrations/0019_plan_section.sql","migrations/0028_sops.sql"]) await db.exec(strip(fs.readFileSync("supabase/"+f,"utf8")));
await db.exec(`alter table public.users enable row level security;`);
await db.exec(`grant usage on schema public to anon, authenticated;
  grant select, insert, update, delete on all tables in schema public to anon, authenticated;
  grant execute on all functions in schema public to anon, authenticated;`);

let pass=0,fail=0; const ok=(c,m)=>{c?(pass++,console.log("  ✅ "+m)):(fail++,console.log("  ❌ "+m));};
const q=async s=>(await db.query(s)).rows;
const one=async s=>(await q(s))[0];
const tryExec=async s=>{ try { await db.exec(s); return null; } catch(e){ return e.message; } };

const A="11111111-1111-1111-1111-111111111111", E="22222222-2222-2222-2222-222222222222";
await db.exec(`insert into auth.users(id,email) values ('${A}','a@t.c'),('${E}','e@t.c');`);
await db.exec(`update public.users set primary_role='admin', full_name='Ada' where id='${A}';`);
await db.exec(`update public.users set primary_role='employee', full_name='Priya' where id='${E}';`);
const as=u=>db.exec(`set role authenticated; set request.jwt.claim.sub='${u}';`);

await db.exec(`insert into public.sop_documents(code,title,purpose,owner_id) values ('SOP-01','Run an event door','How we check people in','${A}');`);
const sop=(await one(`select id from public.sop_documents where code='SOP-01'`)).id;
await db.exec(`insert into public.sop_versions(sop_id,version,body,author_id) values ('${sop}',1,'First draft','${A}');`);
const v1=(await one(`select id from public.sop_versions where sop_id='${sop}' and version=1`)).id;
await db.exec(`insert into public.sop_steps(version_id,sort_order,instruction,pass_criteria,needs_evidence) values
  ('${v1}',1,'Set the scanner up an hour before','Scanner opens and reads a test ticket',false),
  ('${v1}',2,'Photograph the room before doors','Photo attached',true);`);

console.log("\nWhich version is current:");
ok((await one(`select public.bos_sop_current('${sop}') c`)).c===v1,"the only version, before anything is approved");

console.log("\nWho may approve:");
await as(E);
let err=await tryExec(`select public.bos_publish_sop('${v1}')`);
ok(/admin/i.test(err??""),`an employee cannot (${(err??"NOT REFUSED").split("\n")[0].slice(0,45)})`);
await as(A);
ok(await tryExec(`select public.bos_publish_sop('${v1}')`)===null,"an admin can");
const doc=await one(`select state::text s, next_review from public.sop_documents where id='${sop}'`);
ok(doc.s==='published',"the document is published");
ok(doc.next_review!==null,"and a review date was set from the cadence");
ok((await one(`select approved_by from public.sop_versions where id='${v1}'`)).approved_by===A,"the approval records who");

console.log("\nA change is a new version, not an edit:");
await db.exec(`insert into public.sop_versions(sop_id,version,body,change_note,author_id) values ('${sop}',2,'Second draft','Added the photo step','${A}');`);
const v2=(await one(`select id from public.sop_versions where sop_id='${sop}' and version=2`)).id;
ok((await one(`select public.bos_sop_current('${sop}') c`)).c===v1,"an unapproved draft does not become current");
await db.exec(`select public.bos_publish_sop('${v2}')`);
ok((await one(`select public.bos_sop_current('${sop}') c`)).c===v2,"approving it does");

console.log("\nWho has read it:");
await as(E);
ok(await tryExec(`insert into public.sop_acknowledgements(version_id,user_id) values ('${v2}','${E}')`)===null,
   "an employee can acknowledge for themselves");
err=await tryExec(`insert into public.sop_acknowledgements(version_id,user_id) values ('${v2}','${A}')`);
ok(err!==null,"but not on somebody else's behalf");
ok(Number((await one(`select count(*)::int c from public.sop_acknowledgements where version_id='${v2}'`)).c)===1,
   "one acknowledgement recorded");
// The point of versioning: reading v2 says nothing about v1.
ok(Number((await one(`select count(*)::int c from public.sop_acknowledgements where version_id='${v1}'`)).c)===0,
   "acknowledging a version does not acknowledge the previous one");

console.log("\nCarrying it out:");
await db.exec(`insert into public.sop_runs(sop_id,version_id,label,run_by) values ('${sop}','${v2}','October meetup','${E}');`);
const run=(await one(`select id from public.sop_runs where sop_id='${sop}'`)).id;
const steps=await q(`select id from public.sop_steps where version_id='${v1}' order by sort_order`);
ok(await tryExec(`insert into public.sop_run_items(run_id,step_id,state,checked_by,checked_at) values ('${run}','${steps[0].id}','pass','${E}',now())`)===null,
   "an employee can tick a step");
ok(await tryExec(`update public.sop_run_items set state='fail', note='No camera on the night' where run_id='${run}'`)===null,
   "and record a failure with a reason");
ok((await one(`select state::text s from public.sop_run_items where run_id='${run}'`)).s==='fail',"which is what is kept");

console.log("\nAn employee cannot quietly rewrite the procedure:");
err=await tryExec(`update public.sop_versions set body='whatever I like' where id='${v2}'`);
await as(A);
const body=(await one(`select body from public.sop_versions where id='${v2}'`)).body;
ok(body==='Second draft',`the approved text is unchanged (${body})`);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail?1:0);
