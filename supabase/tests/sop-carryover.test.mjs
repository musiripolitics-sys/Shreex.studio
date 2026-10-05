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
for (const f of ["schema.sql","migrations/0007_business_os.sql","migrations/0008_business_os_registries.sql","migrations/0009_business_os_reviews.sql","migrations/0010_business_os_coverage.sql","migrations/0011_business_os_chain.sql","migrations/0012_fix_dashboard_summary.sql","migrations/0015_task_comments.sql","migrations/0016_employee_access.sql","migrations/0017_staff_dashboard.sql","migrations/0018_scope_staff_reads.sql","migrations/0019_plan_section.sql","migrations/0028_sops.sql"]) await db.exec(strip(fs.readFileSync("supabase/"+f,"utf8")));

let pass=0,fail=0; const ok=(c,m)=>{c?(pass++,console.log("  ✅ "+m)):(fail++,console.log("  ❌ "+m));};
const one=async s=>(await db.query(s)).rows[0];

// The six rows as they actually are in production.
await db.exec(`insert into public.sops(process,step,quality_check,pass_criteria,evidence_url) values
 ('Event delivery','1. Announce','Event live with date and venue','Listing published',null),
 ('Event delivery','2. Promote','Campaign live','Campaign running','http://x/proof'),
 ('Event delivery','3. Confirm','Speakers confirmed in writing',null,null),
 ('Event delivery','4. Prepare','Venue and check-in tested',null,null),
 ('Event delivery','5. Deliver','Attendees checked in',null,null),
 ('Event delivery','6. Close','Report written',null,null);`);

await db.exec(fs.readFileSync("supabase/migrations/0031_carry_sops_over.sql","utf8"));

console.log("\nThe stranded procedure is now a document:");
const d=await one(`select id,title,state::text s from public.sop_documents`);
ok(!!d && d.title==='Event delivery',`one document, titled from the process (${d?.title})`);
ok(d.s==='published',"published, because it was already in use");
const v=await one(`select id,version,approved_at from public.sop_versions where sop_id='${d.id}'`);
ok(v.version===1 && v.approved_at!==null,"with one approved version, not a draft nobody signed");
const steps=(await db.query(`select instruction,pass_criteria,needs_evidence from public.sop_steps where version_id='${v.id}' order by sort_order`)).rows;
ok(steps.length===6,`all six steps carried (${steps.length})`);
ok(steps[0].instruction==='1. Announce',"in the order they were written");
ok(steps[0].pass_criteria==='Listing published',"pass criteria preferred over the quality check");
ok(steps[2].pass_criteria==='Speakers confirmed in writing',"falling back to the quality check where there is none");
ok(steps[1].needs_evidence===true && steps[0].needs_evidence===false,"evidence flagged only where a row had one");

console.log("\nNothing is destroyed, and a second run is harmless:");
await db.exec(fs.readFileSync("supabase/migrations/0031_carry_sops_over.sql","utf8"));
ok(Number((await one(`select count(*)::int c from public.sop_documents`)).c)===1,"still one document after running twice");
ok(Number((await one(`select count(*)::int c from public.sop_steps`)).c)===6,"still six steps");
ok(Number((await one(`select count(*)::int c from public.sops`)).c)===6,"the old table is untouched");

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail?1:0);
