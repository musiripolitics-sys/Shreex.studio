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
try { await db.exec(sql); console.log("✅ fresh install: CLEAN"); } catch(e){ console.log("❌", e.message.slice(0,180)); process.exit(2); }
try { await db.exec(sql); console.log("✅ re-run: idempotent"); } catch(e){ console.log("❌ re-run:", e.message.slice(0,140)); process.exit(3); }

const q=async s=>(await db.query(s)).rows;
let pass=0,fail=0; const ok=(c,m)=>{c?(pass++,console.log("  ✅ "+m)):(fail++,console.log("  ❌ "+m));};
const F="11111111-1111-1111-1111-111111111111", P="22222222-2222-2222-2222-222222222222";
const E="44444444-4444-4444-4444-444444444444";
await db.exec(`insert into auth.users(id,email) values ('${F}','f@t.c'),('${P}','p@t.c');`);
await db.exec(`update public.users set full_name='Free Fran', discoverable=true, points=150 where id='${F}';`);
await db.exec(`update public.users set full_name='Pro Pat',  discoverable=true, points=150 where id='${P}';`);
await db.exec(`insert into public.memberships(user_id,tier,status) values ('${P}','Pro','active');`);
await db.exec(`insert into public.events(id,slug,title,category,date,city,venue,status)
  values ('${E}','e','E','Meetup','2030-01-01','C','V','published');`);
await db.exec(`insert into public.registrations(event_id,user_id,attendee_name,attendee_email,status,ticket_code) values
  ('${E}','${F}','F','f@t.c','registered','T1'),('${E}','${P}','P','p@t.c','registered','T2');`);

console.log("\nTier helper:");
await db.exec(`set request.jwt.claim.sub='${P}';`);
ok((await q(`select public.member_tier() t`))[0].t === "Pro", "a Pro membership reports Pro");
ok((await q(`select public.is_paid_member() b`))[0].b === true, "and counts as paid");
await db.exec(`set request.jwt.claim.sub='${F}';`);
ok((await q(`select public.member_tier() t`))[0].t === null, "a free member reports no tier");
ok((await q(`select public.is_paid_member() b`))[0].b === false, "and does not count as paid");

console.log("\nExpiry:");
await db.exec(`update public.memberships set renews_at = now() - interval '1 day' where user_id='${P}';`);
await db.exec(`set request.jwt.claim.sub='${P}';`);
ok((await q(`select public.is_paid_member() b`))[0].b === false, "an expired membership stops counting");
await db.exec(`update public.memberships set renews_at = now() + interval '30 days' where user_id='${P}';`);

console.log("\nAttendee names:");
await db.exec(`set request.jwt.claim.sub='${F}';`);
let r = (await q(`select * from public.event_attendance(array['${E}']::uuid[])`))[0];
ok(r.going === 2, "count is visible to a free member");
ok(r.names.length === 0, "but names are not");
await db.exec(`set request.jwt.claim.sub='${P}';`);
r = (await q(`select * from public.event_attendance(array['${E}']::uuid[])`))[0];
ok(r.going === 2 && r.names.length === 2, "a paid member sees the names");

console.log("\nDirectory:");
await db.exec(`set request.jwt.claim.sub='${F}';`);
ok((await q(`select count(*)::int n from public.get_directory()`))[0].n === 0, "free member gets no rows");
await db.exec(`set request.jwt.claim.sub='${P}';`);
ok((await q(`select count(*)::int n from public.get_directory()`))[0].n > 0, "paid member gets the directory");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
