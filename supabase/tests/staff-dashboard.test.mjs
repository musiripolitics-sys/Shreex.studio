// An employee with grants must be able to load the dashboard, and must see
// counts only for the sections they hold.
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
for (const f of ["schema.sql","migrations/0007_business_os.sql","migrations/0008_business_os_registries.sql","migrations/0009_business_os_reviews.sql","migrations/0010_business_os_coverage.sql","migrations/0011_business_os_chain.sql","migrations/0012_fix_dashboard_summary.sql","migrations/0016_employee_access.sql","migrations/0017_staff_dashboard.sql"]) await db.exec(strip(fs.readFileSync("supabase/"+f,"utf8")));
await db.exec(`grant usage on schema public to anon, authenticated;
  grant select, insert, update, delete on all tables in schema public to anon, authenticated;
  grant execute on all functions in schema public to anon, authenticated;`);

let pass=0,fail=0; const ok=(c,m)=>{c?(pass++,console.log("  ✅ "+m)):(fail++,console.log("  ❌ "+m));};
const q=async s=>(await db.query(s)).rows;
const A="11111111-1111-1111-1111-111111111111", E="22222222-2222-2222-2222-222222222222", M="33333333-3333-3333-3333-333333333333";
await db.exec(`insert into auth.users(id,email) values ('${A}','a@t.c'),('${E}','e@t.c'),('${M}','m@t.c');`);
await db.exec(`update public.users set primary_role='admin' where id='${A}';`);
await db.exec(`update public.users set primary_role='employee' where id='${E}';`);
await db.exec(`insert into public.goals(code,objective) values ('G-1','plan goal');`);
await db.exec(`insert into public.tasks(code,title) values ('T-1','a task');`);
await db.exec(`insert into public.revenue_entries(source,amount,received_on) values ('ticket_sales',5000, current_date);`);
await db.exec(`insert into public.campaigns(code,name) values ('C-1','a campaign');`);
const as=(u)=>db.exec(`set role authenticated; set request.jwt.claim.sub='${u}';`);
const summary=()=>db.query(`select public.bos_dashboard_summary(date '2026-01-01', date '2026-12-31', null, null) s`);
const status=async()=> (await q(`select public.bos_section_status() s`))[0].s;

console.log("\nBefore 0017 the employee was locked out; now:");
await as(A);
await db.exec(`select public.bos_set_module_access('${E}', array['plan','marketing']);`);

await as(E);
let loaded=false;
try { await summary(); loaded=true; } catch(e){ loaded=e.message; }
ok(loaded===true, `an employee can load the dashboard summary${loaded===true?"":" — "+loaded}`);

const st = await status();
ok(Object.keys(st).length>0, "and gets section status back");
ok("roadmap" in st && "tasks" in st, "sees the Plan sections they hold");
ok("campaigns" in st && "content" in st, "sees the Marketing sections they hold");
ok(!("finance" in st) && !("expenses" in st), "does NOT see Money sections they do not hold");
ok(!("risks" in st) && !("legal" in st), "does NOT see Govern sections they do not hold");
ok(st.tasks.total===1 && st.roadmap.total===1, "counts are real, not blanked");

console.log("\nAdmin is unaffected:");
await as(A);
const all = await status();
ok(Object.keys(all).length>=25, `admin still sees every section (${Object.keys(all).length})`);
ok("finance" in all && "risks" in all, "including money and govern");

console.log("\nA member with no grants is still refused:");
await as(M);
let refused=false;
try { await summary(); } catch { refused=true; }
ok(refused,"bos_dashboard_summary raises for a non-staff caller");
refused=false;
try { await status(); } catch { refused=true; }
ok(refused,"bos_section_status raises too");

console.log("\nRevoking takes it away again:");
await as(A);
await db.exec(`select public.bos_set_module_access('${E}', array['marketing']);`);
await as(E);
const after = await status();
ok(!("roadmap" in after) && "campaigns" in after, "Plan counts disappear once Plan is revoked");

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail?1:0);
