// One search box, and it must not become a way around the permissions.
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
const mig=["0007_business_os","0008_business_os_registries","0009_business_os_reviews","0010_business_os_coverage","0011_business_os_chain","0012_fix_dashboard_summary","0015_task_comments","0016_employee_access","0017_staff_dashboard","0018_scope_staff_reads","0019_plan_section","0026_events_in_the_os","0027_host_crm","0028_sops","0029_govern","0032_search"];
await db.exec(strip(fs.readFileSync("supabase/schema.sql","utf8")));
for (const f of mig) { try { await db.exec(strip(fs.readFileSync(`supabase/migrations/${f}.sql`,"utf8"))); } catch(e){ console.log("  skip",f,e.message.split("\n")[0].slice(0,55)); } }
await db.exec(`alter table public.users enable row level security;`);
await db.exec(`grant usage on schema public to anon, authenticated;
  grant select, insert, update, delete on all tables in schema public to anon, authenticated;
  grant execute on all functions in schema public to anon, authenticated;`);

let pass=0,fail=0; const ok=(c,m)=>{c?(pass++,console.log("  ✅ "+m)):(fail++,console.log("  ❌ "+m));};
const q=async s=>(await db.query(s)).rows;
const A="11111111-1111-1111-1111-111111111111", E="22222222-2222-2222-2222-222222222222", F="33333333-3333-3333-3333-333333333333";
await db.exec(`insert into auth.users(id,email) values ('${A}','a@t.c'),('${E}','e@t.c'),('${F}','f@t.c');`);
await db.exec(`update public.users set primary_role='admin', full_name='Ada Admin' where id='${A}';`);
await db.exec(`update public.users set primary_role='employee', full_name='Priya P' where id='${E}';`);
await db.exec(`update public.users set primary_role='employee', full_name='Farid F' where id='${F}';`);
await db.exec(`insert into public.employee_module_access(user_id,section) values ('${E}','plan');`);

await db.exec(`insert into public.tasks(code,title,owner_id,status) values
  ('T-014','Draft the October sponsor deck','${E}','in_progress'),
  ('T-900','Something only Farid owns','${F}','not_started');`);
await db.exec(`insert into public.vendors(name,category) values ('Vercel','Hosting');`);
await db.exec(`insert into public.competitors(name,category) values ('Chennai Geeks','Community');`);

const as=u=>db.exec(`set role authenticated; set request.jwt.claim.sub='${u}';`);
const search=async (u,term)=>{ await as(u); return q(`select kind, title, rank from public.bos_search('${term}')`); };

console.log("\nIt finds things:");
let r=await search(A,"sponsor");
ok(r.some(x=>x.kind==='Task' && /sponsor deck/i.test(x.title)),`a task by a word in its title (${r.length} hits)`);
r=await search(A,"Vercel");
ok(r.some(x=>x.kind==='Vendor'),"a vendor by name");
r=await search(A,"Chennai");
ok(r.some(x=>x.kind==='Competitor'),"a competitor by name");
r=await search(A,"Priya");
ok(r.some(x=>x.kind==='Person'),"a colleague by name");

console.log("\nA code outranks everything, because that is how people refer to work:");
r=await search(A,"T-014");
ok(r[0]?.kind==='Task' && Number(r[0].rank)===1,`T-014 comes first at rank ${r[0]?.rank}`);

console.log("\nIt does not become a way round the permissions:");
r=await search(E,"Something only Farid owns");
ok(!r.some(x=>x.kind==='Task'),"Priya cannot find a task that is not hers and not linked to hers");
r=await search(E,"Vercel");
ok(!r.some(x=>x.kind==='Vendor'),"nor a vendor, holding no Money section");
r=await search(A,"Something only Farid owns");
ok(r.some(x=>x.kind==='Task'),"the admin finds it");

console.log("\nAn empty box finds nothing rather than everything:");
for (const term of ["", "   "]) {
  const n=(await search(A,term)).length;
  ok(n===0,`"${term}" returns ${n} rows`);
}

console.log("\nIt is capped:");
await db.exec(`reset role;`);
for (let i=0;i<60;i++) await db.exec(`insert into public.tasks(code,title,owner_id) values ('X-${i}','Bulk search subject ${i}','${A}')`);
await as(A);
ok((await q(`select * from public.bos_search('Bulk search subject')`)).length<=40,"the default limit holds");
ok((await q(`select * from public.bos_search('Bulk search subject', 5)`)).length===5,"and a smaller one is respected");

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail?1:0);
