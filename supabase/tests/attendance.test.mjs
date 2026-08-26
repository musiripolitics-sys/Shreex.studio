import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const db = new PGlite(); await db.waitReady;
await db.exec(`
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text,
  raw_user_meta_data jsonb, raw_app_meta_data jsonb, encrypted_password text,
  email_confirmed_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $fn$;
create or replace function auth.role() returns text language sql stable as $fn$
  select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'anon') $fn$;
create role authenticated; create role anon; create role service_role;
create or replace function gen_random_bytes(n int) returns bytea language sql as $fn$ select decode(md5(random()::text),'hex') $fn$;
create or replace function crypt(a text,b text) returns text language sql as $fn$ select a $fn$;
create or replace function gen_salt(a text) returns text language sql as $fn$ select 'x' $fn$;
create domain citext as text;`);
const sql = fs.readFileSync("supabase/schema.sql","utf8").replace(/create extension if not exists (pgcrypto|citext);/g,"");
try { await db.exec(sql); console.log("✅ fresh install: CLEAN"); } catch(e){ console.log("❌", e.message.slice(0,200)); process.exit(2); }
try { await db.exec(sql); console.log("✅ re-run: idempotent"); } catch(e){ console.log("❌ re-run:", e.message.slice(0,160)); process.exit(3); }

const q=async s=>(await db.query(s)).rows;
let pass=0,fail=0; const ok=(c,m)=>{c?(pass++,console.log("  ✅ "+m)):(fail++,console.log("  ❌ "+m));};
const E="44444444-4444-4444-4444-444444444444";
const U1="11111111-1111-1111-1111-111111111111", U2="22222222-2222-2222-2222-222222222222";
await db.exec(`insert into auth.users(id,email) values ('${U1}','a@t.c'),('${U2}','b@t.c');`);
await db.exec(`update public.users set full_name='Opted In',  discoverable=true  where id='${U1}';`);
await db.exec(`update public.users set full_name='Opted Out', discoverable=false where id='${U2}';`);
await db.exec(`insert into public.events(id,slug,title,category,date,city,venue,status)
  values ('${E}','e','E','Meetup','2030-01-01','C','V','published');`);
await db.exec(`insert into public.registrations(event_id,user_id,attendee_name,attendee_email,status,ticket_code) values
  ('${E}','${U1}','A','a@t.c','registered','T1'),
  ('${E}','${U2}','B','b@t.c','attended','T2');`);

console.log("\nSigned out:");
await db.exec(`set request.jwt.claim.sub = '';`);
let r = (await q(`select * from public.event_attendance(array['${E}']::uuid[])`))[0];
ok(r.going === 2, "count is public (2 going)");
ok(Array.isArray(r.names) && r.names.length === 0, "but no names are exposed");

console.log("\nSigned in:");
await db.exec(`set request.jwt.claim.sub = '${U1}';`);
r = (await q(`select * from public.event_attendance(array['${E}']::uuid[])`))[0];
ok(r.going === 2, "count still 2");
ok(r.names.length === 1 && r.names[0] === "Opted In", "only the member who opted in is named");
ok(!r.names.includes("Opted Out"), "the opted-out member is never named");

console.log("\nEvent with nobody:");
const E2="55555555-5555-5555-5555-555555555555";
await db.exec(`insert into public.events(id,slug,title,category,date,city,venue,status)
  values ('${E2}','e2','E2','Meetup','2030-01-01','C','V','published');`);
r = (await q(`select * from public.event_attendance(array['${E2}']::uuid[])`))[0];
ok(r && r.going === 0, "an empty event returns a row with 0, not no row");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
