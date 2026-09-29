// The public forms cost an email each, so they cannot be run in a loop.
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
for (const f of ["schema.sql","migrations/0023_rate_limits.sql","migrations/0024_rate_limit_ceiling.sql"]) await db.exec(strip(fs.readFileSync("supabase/"+f,"utf8")));
await db.exec(`grant usage on schema public to anon, authenticated;
  grant select, insert, update, delete on all tables in schema public to anon, authenticated;
  grant execute on all functions in schema public to anon, authenticated;`);

let pass=0,fail=0; const ok=(c,m)=>{c?(pass++,console.log("  ✅ "+m)):(fail++,console.log("  ❌ "+m));};
const tryExec=async s=>{ try { await db.exec(s); return null; } catch(e){ return e.message; } };
const n=async s=>Number((await db.query(s)).rows[0].c);

const contact=(email,i)=>`insert into public.contact_messages(name,email,topic,message) values ('Someone','${email}','General enquiry','hello ${i}')`;

console.log("\nThe contact form, three an hour:");
let err=null;
for (let i=1;i<=3;i++) err = await tryExec(contact("asha@example.com",i)) ?? err;
ok(err===null,"the first three get through");
const fourth = await tryExec(contact("asha@example.com",4));
ok(fourth!==null,`the fourth is refused (${(fourth??"NOT REFUSED").split("\n")[0].slice(0,55)})`);
ok(await n(`select count(*)::int c from public.contact_messages`)===3,"and nothing was written for it");

console.log("\nSomebody else is unaffected:");
ok(await tryExec(contact("ravi@example.com",1))===null,"a different address still works");

console.log("\nCase and whitespace do not get you a fresh allowance:");
ok(await tryExec(contact("  ASHA@example.com  ",5))!==null,"the key is normalised");

console.log("\nThe newsletter, keyed on the address:");
ok(await tryExec(`insert into public.newsletter_subscribers(email,source) values ('new@example.com','footer')`)===null,
   "a new subscriber is accepted");
// The unique index catches a repeat of the same address first; the limit is
// there for a loop of different ones.
const dup = await tryExec(`insert into public.newsletter_subscribers(email,source) values ('new@example.com','footer')`);
ok(dup!==null,"a repeat is refused");

console.log("\nThe counter itself:");
ok((await db.query(`select public.bos_rate_limit('t','k',2,interval '1 hour') a`)).rows[0].a===true,"first hit allowed");
ok((await db.query(`select public.bos_rate_limit('t','k',2,interval '1 hour') a`)).rows[0].a===true,"second allowed");
ok((await db.query(`select public.bos_rate_limit('t','k',2,interval '1 hour') a`)).rows[0].a===false,"third refused");
ok((await db.query(`select public.bos_rate_limit('t','other',2,interval '1 hour') a`)).rows[0].a===true,"a different key has its own allowance");
ok((await db.query(`select public.bos_rate_limit('other','k',2,interval '1 hour') a`)).rows[0].a===true,"so does a different bucket");
ok((await db.query(`select public.bos_rate_limit('t',null,2,interval '1 hour') a`)).rows[0].a===true,"no key means no opinion");


console.log("\nA loop using a different address every time:");
// This is the attack the per-address limit cannot see. Each of these keys is
// distinct, so only the ceiling can stop it.
let accepted=0, refusal=null;
for (let i=0;i<60;i++){
  const e=`loop${i}@example.com`;
  const r=await tryExec(`insert into public.contact_messages(name,email,topic,message) values ('Loop','${e}','General enquiry','x')`);
  if (r===null) accepted++; else { refusal=r; break; }
}
ok(refusal!==null,`it is stopped (${(refusal??"NEVER STOPPED").split("\n")[0].slice(0,55)})`);
ok(accepted<60,`after ${accepted} rather than running forever`);

console.log("\nThe newsletter has the same ceiling:");
let nAccepted=0, nRefusal=null;
for (let i=0;i<50;i++){
  const r=await tryExec(`insert into public.newsletter_subscribers(email,source) values ('nl${i}@example.com','probe')`);
  if (r===null) nAccepted++; else { nRefusal=r; break; }
}
ok(nRefusal!==null,`a loop of distinct addresses is stopped after ${nAccepted}`);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail?1:0);
