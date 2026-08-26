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
await db.exec(fs.readFileSync("supabase/schema.sql","utf8").replace(/create extension if not exists (pgcrypto|citext);/g,""));

const U = "11111111-1111-1111-1111-111111111111";
const be = (u) => db.exec(`set request.jwt.claim.sub = '${u}';`);
const q  = async (s) => (await db.query(s)).rows;
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  ✅ " + m)) : (fail++, console.log("  ❌ " + m)); };

await db.exec(`insert into auth.users(id,email) values ('${U}','m@t.c');`);
await db.exec(`update public.users set full_name='M', points=0 where id='${U}';`);

console.log("\nEarning:");
await db.exec(`select public.award_credits('${U}', 10, 'Attended X', null);`);
ok((await q(`select points from public.users where id='${U}'`))[0].points === 10, "award_credits raises the balance");
ok((await q(`select count(*)::int c from public.point_events where user_id='${U}'`))[0].c === 1, "and writes exactly one ledger row");

console.log("\nSpending:");
await be(U);
await db.exec(`select public.spend_credits(4, 'Downloaded slides', null);`);
ok((await q(`select points from public.users where id='${U}'`))[0].points === 6, "spend_credits debits the balance");
const led = await q(`select delta from public.point_events where user_id='${U}' order by created_at`);
ok(led.map(r=>r.delta).join(",") === "10,-4", "ledger records +10 then -4");

let raised = false;
try { await db.exec(`select public.spend_credits(999, 'too much', null);`); } catch { raised = true; }
ok(raised, "overspending raises instead of going negative");
ok((await q(`select points from public.users where id='${U}'`))[0].points === 6, "balance unchanged after the failed spend");
ok((await q(`select count(*)::int c from public.point_events where user_id='${U}'`))[0].c === 2, "no ledger row written for the failed spend");

console.log("\nGates (balance 6):");
ok((await q(`select public.meets_gate('comment') g`))[0].g === false, "comment gate (hold 10) blocks at 6");
await db.exec(`select public.award_credits('${U}', 10, 'Attended Y', null);`);
ok((await q(`select public.meets_gate('comment') g`))[0].g === true,  "clears at 16");
ok((await q(`select public.meets_gate('post_global') g`))[0].g === false, "global gate (hold 30) still blocks at 16");
ok((await q(`select public.meets_gate('nonexistent_action') g`))[0].g === true, "unknown action defaults to allowed");

console.log("\nDownloads:");
const A = "22222222-2222-2222-2222-222222222222";
await db.exec(`insert into auth.users(id,email) values ('${A}','a@t.c');`);
await db.exec(`insert into public.events(id,slug,title,category,date,city,venue,status)
  values ('33333333-3333-3333-3333-333333333333','s','Sess','Workshop','2030-01-01','C','V','published');`);
await db.exec(`insert into public.community_files(id,event_id,title,storage_path,credit_cost,created_by)
  values ('44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333','Slides','g/slides.pdf',10,'${A}');`);

await be(U);
let r = (await q(`select public.unlock_file('44444444-4444-4444-4444-444444444444') j`))[0].j;
ok(r.status === "denied", "non-attendee is refused the session file");

// Now attend it.
await db.exec(`insert into public.registrations(event_id,user_id,attendee_name,attendee_email,status,ticket_code)
  values ('33333333-3333-3333-3333-333333333333','${U}','M','m@t.c','attended','TIX1');`);
await db.exec(`update public.users set points = 10 where id='${U}';`);
r = (await q(`select public.unlock_file('44444444-4444-4444-4444-444444444444') j`))[0].j;
ok(r.status === "ok" && r.path === "g/slides.pdf", "attendee with enough credits gets the path");
ok((await q(`select points from public.users where id='${U}'`))[0].points === 0, "credits were spent");

r = (await q(`select public.unlock_file('44444444-4444-4444-4444-444444444444') j`))[0].j;
ok(r.status === "ok", "second download still works");
ok((await q(`select points from public.users where id='${U}'`))[0].points === 0, "and is NOT charged twice");

// Broke member, new file.
await db.exec(`insert into public.community_files(id,event_id,title,storage_path,credit_cost,created_by)
  values ('55555555-5555-5555-5555-555555555555','33333333-3333-3333-3333-333333333333','Recording','g/rec.mp4',25,'${A}');`);
r = (await q(`select public.unlock_file('55555555-5555-5555-5555-555555555555') j`))[0].j;
ok(r.status === "short" && r.needed === 25 && r.balance === 0, "short balance is reported, not charged");
ok(/costs 25 credits — you have 0/.test(r.message), "message states the shortfall plainly");

// Free file.
await db.exec(`insert into public.community_files(id,event_id,title,storage_path,credit_cost,created_by)
  values ('66666666-6666-6666-6666-666666666666','33333333-3333-3333-3333-333333333333','Notes','g/n.md',0,'${A}');`);
r = (await q(`select public.unlock_file('66666666-6666-6666-6666-666666666666') j`))[0].j;
ok(r.status === "ok", "free file needs no credits");

console.log("\nBackfill idempotency:");
const before = (await q(`select count(*)::int c from public.point_events`))[0].c;
const bf = `insert into public.point_events (user_id, delta, reason)
  select u.id, u.points, 'x' from public.users u where u.points > 0
   and not exists (select 1 from public.point_events pe where pe.user_id = u.id);`;
await db.exec(bf); await db.exec(bf);
ok((await q(`select count(*)::int c from public.point_events`))[0].c === before, "re-running the backfill adds nothing");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
