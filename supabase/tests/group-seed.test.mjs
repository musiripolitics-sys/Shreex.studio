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
try { await db.exec(sql); console.log("✅ fresh install: CLEAN"); }
catch(e){ console.log("❌ FAILED:", e.message); process.exit(2); }
try { await db.exec(sql); console.log("✅ re-run: idempotent"); }
catch(e){ console.log("❌ re-run FAILED:", e.message.slice(0,160)); process.exit(3); }

const q=async s=>(await db.query(s)).rows, n=async s=>(await q(s))[0].n;
let pass=0,fail=0; const ok=(c,m)=>{c?(pass++,console.log("  ✅ "+m)):(fail++,console.log("  ❌ "+m));};

const H="11111111-1111-1111-1111-111111111111", M="22222222-2222-2222-2222-222222222222";
const E="33333333-3333-3333-3333-333333333333";
await db.exec(`insert into auth.users(id,email) values ('${H}','h@t.c'),('${M}','m@t.c');`);
await db.exec(`update public.users set full_name='Host H' where id='${H}';`);
await db.exec(`insert into public.user_roles(user_id,role) values ('${H}','admin') on conflict do nothing;`);
await db.exec(`insert into public.events(id,slug,title,category,date,city,venue,status,host_id)
  values ('${E}','s','React Workshop','Workshop','2030-01-01','C','V','published','${H}');`);
await db.exec(`insert into public.registrations(event_id,user_id,attendee_name,attendee_email,status,ticket_code)
  values ('${E}','${M}','M','m@t.c','registered','TIX9');`);

console.log("\nCheck-in seeds the group:");
ok(await n(`select count(*)::int n from public.posts where event_id='${E}'`) === 0, "group starts empty");
await db.exec(`set request.jwt.claim.sub = '${H}';`);
const r = (await q(`select public.check_in_ticket('TIX9') j`))[0].j;
ok(r.status === "ok", "check-in succeeds");
ok(await n(`select count(*)::int n from public.posts where event_id='${E}'`) === 1, "a welcome post now exists");
const post = (await q(`select body, pinned, author_name from public.posts where event_id='${E}'`))[0];
ok(post.pinned === true, "and it is pinned");
ok(post.body.includes("React Workshop"), "it names the event");
ok(post.author_name === "Host H", "attributed to the event's host");
ok(await n(`select points as n from public.users where id='${M}'`) === 10, "attendee still got their 10 credits");

console.log("\nNo duplicates:");
await db.exec(`insert into public.registrations(event_id,user_id,attendee_name,attendee_email,status,ticket_code)
  values ('${E}','${M}','M2','m2@t.c','registered','TIX8');`);
await db.exec(`select public.check_in_ticket('TIX8');`);
ok(await n(`select count(*)::int n from public.posts where event_id='${E}'`) === 1, "a second check-in does not add another welcome post");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
