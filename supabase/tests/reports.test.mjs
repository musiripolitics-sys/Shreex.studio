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

const q = async s => (await db.query(s)).rows;
const n = async s => (await q(s))[0].n;
let pass=0, fail=0; const ok=(c,m)=>{c?(pass++,console.log("  ✅ "+m)):(fail++,console.log("  ❌ "+m));};

const M="11111111-1111-1111-1111-111111111111", A="22222222-2222-2222-2222-222222222222", B="33333333-3333-3333-3333-333333333333";
for (const [id,em] of [[M,"m@t.c"],[A,"a@t.c"],[B,"b@t.c"]]) await db.exec(`insert into auth.users(id,email) values ('${id}','${em}');`);
await db.exec(`insert into public.user_roles(user_id, role) values ('${A}','admin') on conflict do nothing;`);
await db.exec(`insert into public.posts(id,author_id,author_name,body) values
  ('44444444-4444-4444-4444-444444444444','${B}','B','spam spam');`);

console.log("\nReporting:");
await db.exec(`set request.jwt.claim.sub = '${M}';`);
let r = (await q(`select public.report_content('44444444-4444-4444-4444-444444444444', null, 'Spam') j`))[0].j;
ok(r.status === "ok", "a member can report a post");
ok(await n(`select count(*)::int n from public.post_reports`) === 1, "a report row is stored");
ok(await n(`select count(*)::int n from public.notifications where user_id='${A}' and type='report'`) === 1,
   "the admin is notified");

r = (await q(`select public.report_content('44444444-4444-4444-4444-444444444444', null, 'Spam again') j`))[0].j;
ok(/already reported/i.test(r.message), "reporting twice is refused politely");
ok(await n(`select count(*)::int n from public.notifications where user_id='${A}'`) === 1,
   "and does NOT notify the admin a second time");

console.log("\nTarget validation:");
r = (await q(`select public.report_content(null, null, 'x') j`))[0].j;
ok(r.status === "denied", "a report with no target is rejected");
let threw=false;
try { await db.exec(`insert into public.post_reports(post_id,comment_id,reporter_id)
  values ('44444444-4444-4444-4444-444444444444','44444444-4444-4444-4444-444444444444','${M}');`); }
catch { threw = true; }
ok(threw, "a row targeting both a post and a comment is rejected by the constraint");

console.log("\nResolving:");
await db.exec(`set request.jwt.claim.sub = '${A}';`);
const rid = (await q(`select id from public.post_reports limit 1`))[0].id;
await db.exec(`select public.resolve_report('${rid}');`);
ok(await n(`select count(*)::int n from public.post_reports where resolved`) === 1, "an admin can resolve a report");

await db.exec(`set request.jwt.claim.sub = '${M}';`);
threw = false;
try { await db.exec(`select public.resolve_report('${rid}');`); } catch { threw = true; }
ok(threw, "a non-admin cannot resolve a report");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
