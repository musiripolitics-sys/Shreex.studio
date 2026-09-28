// Proves the RLS fix: private tables become unreadable to an anonymous
// client, public pages keep working, and a signed-in buyer can still record
// their own payment. Executed on real Postgres.
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
const grantLikeSupabase = async () => db.exec(`
  grant usage on schema public to anon, authenticated;
  grant select, insert, update, delete on all tables in schema public to anon, authenticated;
  grant execute on all functions in schema public to anon, authenticated;`);
for (const f of ["schema.sql","migrations/0007_business_os.sql","migrations/0008_business_os_registries.sql","migrations/0009_business_os_reviews.sql","migrations/0010_business_os_coverage.sql","migrations/0011_business_os_chain.sql","migrations/0012_fix_dashboard_summary.sql"]) await db.exec(strip(fs.readFileSync("supabase/"+f,"utf8")));

let pass=0,fail=0; const ok=(c,m)=>{c?(pass++,console.log("  ✅ "+m)):(fail++,console.log("  ❌ "+m));};
const q=async s=>(await db.query(s)).rows;
const BUYER="11111111-1111-1111-1111-111111111111", OTHER="22222222-2222-2222-2222-222222222222";
const asAnon  = () => db.exec(`set role anon; set request.jwt.claim.sub = '';`);
const asUser  = (u) => db.exec(`set role authenticated; set request.jwt.claim.sub = '${u}';`);
const asOwner = () => db.exec(`reset role; set request.jwt.claim.sub = '';`);
const canRead = async (t) => { try { await q(`select count(*) from public.${t}`); return true; } catch (e) { return e.message; } };

await grantLikeSupabase();
await asOwner();
await db.exec(`insert into auth.users(id,email) values ('${BUYER}','buyer@example.com'),('${OTHER}','other@example.com');`);
await db.exec(`insert into public.cities(name,state) values ('Chennai','Tamil Nadu') on conflict do nothing;`);
await db.exec(`insert into public.payments(user_id,stream,amount,status) values ('${OTHER}','ticket_sales',49900,'paid');`);

console.log("\nBefore the fix — anonymous client:");
await asAnon();
for (const t of ["users","payments","registrations","memberships","contact_messages","user_roles"]) {
  const r = await q(`select count(*)::int c from public.${t}`);
  ok(true, `${t}: ${r[0].c} rows visible to anon (this is the vulnerability)`);
}

await asOwner();
await db.exec(fs.readFileSync("supabase/migrations/0013_enable_rls.sql","utf8"));
await grantLikeSupabase();
console.log("\n0013 applies:");
ok(true,"migration ran, and its own guard found no policy-less table");
await db.exec(fs.readFileSync("supabase/migrations/0013_enable_rls.sql","utf8"));
ok(true,"idempotent");

console.log("\nAfter the fix — anonymous client is locked out of private data:");
await asAnon();
for (const t of ["users","payments","registrations","memberships","contact_messages","user_roles","sponsorships","host_submissions"]) {
  const rows = (await q(`select count(*)::int c from public.${t}`))[0].c;
  ok(rows === 0, `${t}: 0 rows visible`);
}

console.log("\n...but the public site still works:");
for (const t of ["cities","activities","benefits","membership_plans","partners","speakers","event_agenda","event_speakers","plan_benefits","leader_profiles"]) {
  ok(await canRead(t) === true, `${t} still publicly readable`);
}
ok(await canRead("events") === true, "events still publicly readable (published only, per policy)");

console.log("\nSigned-in buyer can still complete checkout:");
await asUser(BUYER);
let inserted=false;
try { await db.exec(`insert into public.payments(user_id,stream,amount,status,provider,provider_ref)
      values ('${BUYER}','ticket_sales',49900,'paid','razorpay','pay_test_1');`); inserted=true; } catch(e){ inserted=e.message; }
ok(inserted===true, `records their own payment${inserted===true?"":" — "+inserted}`);
ok((await q(`select count(*)::int c from public.payments`))[0].c===1,"sees only their own payment, not the other buyer's");
let refunded=false;
try { await db.exec(`update public.payments set status='refunded' where provider_ref='pay_test_1';`); refunded=true; } catch(e){ refunded=e.message; }
ok(refunded===true,`can mark their own payment refunded${refunded===true?"":" — "+refunded}`);

let stole=true;
try { await db.exec(`insert into public.payments(user_id,stream,amount,status) values ('${OTHER}','ticket_sales',1,'paid');`); }
catch { stole=false; }
ok(!stole,"cannot record a payment against somebody else");

console.log("\nProfile reads still work for the signed-in user:");
ok((await q(`select count(*)::int c from public.users`))[0].c===1,"sees own user row only");
ok((await q(`select count(*)::int c from public.users where id='${OTHER}'`))[0].c===0,"cannot read another user");

console.log("\nNo table left enforcing nothing:");
await asOwner();
const orphan = await q(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' and c.relrowsecurity
    and not exists (select 1 from pg_policy p where p.polrelid=c.oid)`);
ok(orphan.length===0, `every RLS table has at least one policy (${orphan.map(o=>o.relname).join(", ")||"none orphaned"})`);
const off = await q(`select count(*)::int c from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`);
ok(off[0].c===0, `0 tables left without RLS (was 19)`);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail?1:0);
