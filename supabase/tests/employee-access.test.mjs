// Per-employee section access: grants decide what an employee sees, admins
// always see everything, and only an admin can change a grant.
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
for (const f of ["schema.sql","migrations/0007_business_os.sql","migrations/0008_business_os_registries.sql","migrations/0009_business_os_reviews.sql","migrations/0010_business_os_coverage.sql","migrations/0011_business_os_chain.sql","migrations/0012_fix_dashboard_summary.sql","migrations/0016_employee_access.sql"]) await db.exec(strip(fs.readFileSync("supabase/"+f,"utf8")));
await db.exec(`grant usage on schema public to anon, authenticated;
  grant select, insert, update, delete on all tables in schema public to anon, authenticated;
  grant execute on all functions in schema public to anon, authenticated;`);

let pass=0,fail=0; const ok=(c,m)=>{c?(pass++,console.log("  ✅ "+m)):(fail++,console.log("  ❌ "+m));};
const q=async s=>(await db.query(s)).rows;
const A="11111111-1111-1111-1111-111111111111", E="22222222-2222-2222-2222-222222222222",
      F="33333333-3333-3333-3333-333333333333", M="44444444-4444-4444-4444-444444444444";
await db.exec(`insert into auth.users(id,email) values ('${A}','admin@t.c'),('${E}','emp@t.c'),('${F}','emp2@t.c'),('${M}','member@t.c');`);
await db.exec(`update public.users set primary_role='admin' where id='${A}';`);
await db.exec(`update public.users set primary_role='employee' where id in ('${E}','${F}');`);
const as=(u)=>db.exec(`set role authenticated; set request.jwt.claim.sub='${u}';`);
const owner=()=>db.exec(`reset role; set request.jwt.claim.sub='';`);
const sections=async()=> (await q(`select public.bos_my_sections() s`))[0].s;
const can=async(sec)=> (await q(`select public.bos_can_access('${sec}') c`))[0].c;

console.log("\nBefore any grant:");
await as(A);
ok((await sections()).length===9,"an admin sees all nine sections without a grant");
await as(E);
ok((await sections()).length===0,"a new employee sees none");
ok((await can("plan"))===false,"and cannot access plan");
await as(M);
ok((await sections()).length===0,"a plain member sees none");

console.log("\nGranting:");
await as(A);
await db.exec(`select public.bos_set_module_access('${E}', array['plan','events','marketing']);`);
await as(E);
const got = await sections();
ok(got.length===3 && got.includes("plan") && got.includes("events") && got.includes("marketing"),
   `employee now sees exactly the three granted (${got.join(", ")})`);
ok((await can("plan"))===true,"can access a granted section");
ok((await can("money"))===false,"still cannot access an ungranted one");
await as(F);
ok((await sections()).length===0,"the grant did not leak to another employee");

console.log("\nReplacing the set:");
await as(A);
await db.exec(`select public.bos_set_module_access('${E}', array['money','govern']);`);
await as(E);
const after = await sections();
ok(after.length===2 && after.includes("money") && !after.includes("plan"),
   `replacing removes what is no longer granted (${after.join(", ")})`);
await as(A);
await db.exec(`select public.bos_set_module_access('${E}', array[]::text[]);`);
await as(E);
ok((await sections()).length===0,"an empty set revokes everything");

console.log("\nOnly an admin may change grants:");
let blocked=false;
try { await db.exec(`select public.bos_set_module_access('${F}', array['plan']);`); } catch { blocked=true; }
ok(blocked,"an employee cannot grant themselves or anyone else");
await as(A);
blocked=false;
try { await db.exec(`select public.bos_set_module_access('${A}', array['plan']);`); } catch { blocked=true; }
ok(blocked,"an admin cannot edit their own access and lock themselves out");

console.log("\nDirect table writes are refused too:");
await as(E);
blocked=false;
try { await db.exec(`insert into public.employee_module_access(user_id,section) values ('${E}','money');`); }
catch { blocked=true; }
ok(blocked,"an employee cannot insert a grant row directly");
await as(A);
await db.exec(`select public.bos_set_module_access('${E}', array['plan']);`);
await as(E);
ok((await q(`select count(*)::int c from public.employee_module_access`))[0].c===1,
   "an employee reads only their own grants");
await as(F);
ok((await q(`select count(*)::int c from public.employee_module_access`))[0].c===0,
   "and cannot read anyone else's");

console.log("\nCascade:");
await owner();
await db.exec(`delete from public.users where id='${E}';`);
ok((await q(`select count(*)::int c from public.employee_module_access`))[0].c===0,
   "removing a user removes their grants");

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail?1:0);
