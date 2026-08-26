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
try { await db.exec(sql); console.log("✅ fresh install: CLEAN"); } catch(e){ console.log("❌", e.message); process.exit(2); }
try { await db.exec(sql); console.log("✅ re-run: idempotent"); } catch(e){ console.log("❌ re-run:", e.message.slice(0,160)); process.exit(3); }

const q=async s=>(await db.query(s)).rows, n=async s=>(await q(s))[0].n;
let pass=0,fail=0; const ok=(c,m)=>{c?(pass++,console.log("  ✅ "+m)):(fail++,console.log("  ❌ "+m));};
const be = u => db.exec(`set request.jwt.claim.sub = '${u}';`);

const A="11111111-1111-1111-1111-111111111111", B="22222222-2222-2222-2222-222222222222";
const C="33333333-3333-3333-3333-333333333333";
await db.exec(`insert into auth.users(id,email) values ('${A}','a@t.c'),('${B}','b@t.c');`);
await db.exec(`insert into public.communities(id,slug,name,kind,city,created_by)
  values ('${C}','chennai','TXF Chennai','city','Chennai','${A}');`);

console.log("\nJoining:");
ok(await n(`select member_count as n from public.communities where id='${C}'`) === 0, "starts with no members");
await be(A);
let r = (await q(`select public.join_community('${C}') j`))[0].j;
ok(r.status === "joined", "an open chapter joins immediately");
ok(await n(`select member_count as n from public.communities where id='${C}'`) === 1, "member_count updates via trigger");
await db.exec(`select public.join_community('${C}');`);
ok(await n(`select count(*)::int n from public.community_members where community_id='${C}'`) === 1, "joining twice is idempotent");

console.log("\nApproval policy:");
await db.exec(`update public.communities set join_policy='approval' where id='${C}';`);
await be(B);
r = (await q(`select public.join_community('${C}') j`))[0].j;
ok(r.status === "pending", "an approval chapter holds the request");
ok(await n(`select member_count as n from public.communities where id='${C}'`) === 1, "pending members don't inflate the count");

console.log("\nMembership predicates:");
await be(A);
ok((await q(`select public.is_community_member('${C}') g`))[0].g === true, "active member passes is_community_member");
await be(B);
ok((await q(`select public.is_community_member('${C}') g`))[0].g === false, "pending member does not");
ok((await q(`select public.can_read_community('${C}') g`))[0].g === true, "but can still read a public chapter");
await db.exec(`update public.communities set is_public=false where id='${C}';`);
ok((await q(`select public.can_read_community('${C}') g`))[0].g === false, "and cannot read a private one");

console.log("\nLeaving:");
await be(A);
await db.exec(`select public.leave_community('${C}');`);
ok(await n(`select member_count as n from public.communities where id='${C}'`) === 0, "leaving decrements the count");

console.log("\nEvents stay independent:");
await db.exec(`insert into public.events(slug,title,category,date,city,venue,status)
  values ('solo','Solo','Meetup','2030-01-01','C','V','published');`);
ok(await n(`select count(*)::int n from public.events where community_id is null`) === 1,
   "an event with no chapter still publishes");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
