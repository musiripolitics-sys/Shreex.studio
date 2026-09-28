// bos_dashboard_summary must actually execute, not merely compile. PL/pgSQL
// parses a statement on first execution, so an oversized jsonb_build_object
// creates cleanly and fails only when the dashboard calls it.
import { PGlite } from "@electric-sql/pglite"; import fs from "fs";
const db=new PGlite(); await db.waitReady;
await db.exec(`create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb, raw_app_meta_data jsonb, encrypted_password text, email_confirmed_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
create or replace function auth.uid() returns uuid language sql stable as $fn$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $fn$;
create or replace function auth.role() returns text language sql stable as $fn$ select 'anon' $fn$;
create role authenticated; create role anon; create role service_role;
create or replace function gen_random_bytes(n int) returns bytea language sql as $fn$ select decode(md5(random()::text),'hex') $fn$;
create or replace function crypt(a text,b text) returns text language sql as $fn$ select a $fn$;
create or replace function gen_salt(a text) returns text language sql as $fn$ select 'x' $fn$;
create domain citext as text;`);
const strip=s=>s.replace(/create extension if not exists (pgcrypto|citext);/g,"");
let pass=0,fail=0; const ok=(c,m)=>{c?(pass++,console.log("  ✅ "+m)):(fail++,console.log("  ❌ "+m));};
const call = () => db.query(`select public.bos_dashboard_summary(date '2026-01-01', date '2026-12-31', null, null) s`);

for (const f of ["schema.sql","migrations/0007_business_os.sql","migrations/0008_business_os_registries.sql","migrations/0009_business_os_reviews.sql","migrations/0010_business_os_coverage.sql","migrations/0011_business_os_chain.sql"]) await db.exec(strip(fs.readFileSync("supabase/"+f,"utf8")));
const A="11111111-1111-1111-1111-111111111111";
await db.exec(`insert into auth.users(id,email) values ('${A}','a@t.c');`);
await db.exec(`update public.users set primary_role='admin' where id='${A}';`);
await db.exec(`set request.jwt.claim.sub='${A}';`);

console.log("\nBefore the fix:");
let broke=false;
try { await call(); } catch(e){ broke = e.message.includes("more than 100 arguments"); }
ok(broke,"0010 raises the argument-limit error at runtime");

console.log("\nAfter 0012:");
await db.exec(fs.readFileSync("supabase/migrations/0012_fix_dashboard_summary.sql","utf8"));
ok(true,"0012 applies");
await db.exec(fs.readFileSync("supabase/migrations/0012_fix_dashboard_summary.sql","utf8"));
ok(true,"0012 is idempotent");

let d=null;
try { d=(await call()).rows[0].s; ok(true,"bos_dashboard_summary now runs"); }
catch(e){ ok(false,"still failing — "+e.message); }

if (d) {
  ok(Object.keys(d).length===66,`returns all 66 keys (got ${Object.keys(d).length})`);
  for (const k of ["revenue_actual","expenses_total","members_total","tasks_overdue","tasks_due_today",
                   "app_progress","leads_total","weighted_pipeline","employees","risks_open",
                   "approvals_pending","goals","range"])
    ok(k in d, `key present: ${k}`);
  ok(typeof d.goals==="object" && d.goals!==null,"goals is a nested object");
  ok(d.range?.from==="2026-01-01" && d.range?.to==="2026-12-31","range echoes the requested window");
  ok(Number(d.revenue_actual)===0 && Number(d.tasks_overdue)===0,"empty database returns zeroes, not nulls");
}

console.log("\nWith the roadmap loaded:");
await db.exec(`insert into public.goals(code,objective,status,end_date) values ('X-1','test','not_started', current_date - 5);`);
await db.exec(`insert into public.tasks(code,title,status,due_date,goal_id)
               select 'Y-1','t','in_progress', current_date - 3, id from public.goals where code='X-1';`);
const d2=(await call()).rows[0].s;
ok(Number(d2.tasks_overdue)===1,`counts the overdue task (got ${d2.tasks_overdue})`);
ok(d2.goals?.not_started===1,"breaks goals down by status");

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail?1:0);
