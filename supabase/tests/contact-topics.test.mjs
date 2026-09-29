// Every topic the contact form offers has to be one the database accepts.
// "Careers / Job Application" was in the dropdown and not in the enum, so
// every job application submitted through the site failed and told the person
// to try again.
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
for (const f of ["schema.sql","migrations/0023_rate_limits.sql","migrations/0024_rate_limit_ceiling.sql","migrations/0025_careers_topic.sql"]) await db.exec(strip(fs.readFileSync("supabase/"+f,"utf8")));
let pass=0,fail=0; const ok=(c,m)=>{c?(pass++,console.log("  ✅ "+m)):(fail++,console.log("  ❌ "+m));};
const tryExec=async s=>{ try { await db.exec(s); return null; } catch(e){ return e.message; } };
console.log("\nEvery option the form offers:");
// Taken from the component rather than copied, so adding a seventh option
// without a migration fails here instead of in production.
const src = fs.readFileSync("src/components/ContactForm.tsx","utf8");
const block = src.match(/const topics = \[([\s\S]*?)\] as const;/);
if (!block) { console.log("  ❌ could not find the topics list in ContactForm.tsx"); process.exit(1); }
const topics = [...block[1].matchAll(/"([^"]+)"/g)].map(m=>m[1]);
console.log(`  (${topics.length} options read from ContactForm.tsx)`);
for (const t of topics) {
  const err=await tryExec(`insert into public.contact_messages(name,email,topic,message) values ('X','${t.replace(/\W/g,"")}@example.com','${t}','hi')`);
  ok(err===null, `"${t}"${err?` — ${err.split("\n")[0].slice(0,50)}`:""}`);
}
console.log("\nRunning it twice is harmless:");
ok(await tryExec(`alter type public.contact_topic add value if not exists 'Careers / Job Application'`)===null,"idempotent");
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail?1:0);
