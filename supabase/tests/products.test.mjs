/**
 * Products as data — Stage 1 of the BOS Product Model plan.
 *
 * What this has to prove: the nine products now live in a table, the grant
 * table learns the list from that table rather than from a CHECK constraint,
 * disabling a product removes it from everyone including admins, and none of
 * it loosens the access rules that were already there.
 */
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";

const db = new PGlite();
await db.waitReady;
await db.exec(`create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb, raw_app_meta_data jsonb, encrypted_password text, email_confirmed_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
create or replace function auth.uid() returns uuid language sql stable as $fn$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $fn$;
create or replace function auth.role() returns text language sql stable as $fn$ select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'anon') $fn$;
create role authenticated; create role anon; create role service_role;
create or replace function gen_random_bytes(n int) returns bytea language sql as $fn$ select decode(md5(random()::text),'hex') $fn$;
create or replace function crypt(a text,b text) returns text language sql as $fn$ select a $fn$;
create or replace function gen_salt(a text) returns text language sql as $fn$ select 'x' $fn$;
create domain citext as text;`);
const strip = s => s.replace(/create extension if not exists (pgcrypto|citext);/g, "");
for (const f of ["schema.sql", "migrations/0007_business_os.sql", "migrations/0016_employee_access.sql",
                 "migrations/0033_products.sql"])
  await db.exec(strip(fs.readFileSync("supabase/" + f, "utf8")));
await db.exec(`alter table public.users enable row level security;`);
await db.exec(`grant usage on schema public to anon, authenticated;
  grant select, insert, update, delete on all tables in schema public to anon, authenticated;
  grant execute on all functions in schema public to anon, authenticated;
  grant usage, select on all sequences in schema public to anon, authenticated;`);

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  ✅ " + m)) : (fail++, console.log("  ❌ " + m)); };
const q = async s => (await db.query(s)).rows;
const one = async s => (await q(s))[0];
const tryExec = async s => { try { await db.exec(s); return null; } catch (e) { return e.message; } };

const A = "11111111-1111-1111-1111-111111111111";
const E = "22222222-2222-2222-2222-222222222222";
await db.exec(`insert into auth.users(id,email) values ('${A}','a@t.c'),('${E}','e@t.c');`);
await db.exec(`update public.users set primary_role='admin',    full_name='Ada'   where id='${A}';`);
await db.exec(`update public.users set primary_role='employee', full_name='Priya' where id='${E}';`);
const as = u => db.exec(`set role authenticated; set request.jwt.claim.sub='${u}';`);

console.log("\nThe catalogue is a table, not a constant:");
const all = await q(`select key, name, sort_order from public.products order by sort_order`);
ok(all.length === 9, `nine products seeded (${all.map(p => p.key).join(", ")})`);
ok(all[0].key === "plan" && all[8].key === "insights", "in the order the nav renders them");
ok(all.every(p => p.name && p.name.length > 1), "each with a display name the admin can edit");

console.log("\nThe grant table learns the list from the catalogue:");
ok(!(await one(`select exists(select 1 from pg_constraint
      where conrelid='public.employee_module_access'::regclass
        and conname='employee_module_access_section_check') e`)).e,
   "the CHECK constraint that hard-coded the nine names is gone");
ok((await one(`select exists(select 1 from pg_constraint
      where conrelid='public.employee_module_access'::regclass
        and conname='employee_module_access_section_fkey') e`)).e,
   "and a foreign key to products(key) stands in its place");

const bogus = await tryExec(
  `insert into public.employee_module_access(user_id,section) values ('${E}','warehouse')`);
ok(bogus !== null && /foreign key|violates/i.test(bogus),
   "a grant naming a product that does not exist is refused by the database");

console.log("\nA tenth product is an insert, not a migration:");
await db.exec(`insert into public.products(key,name,sort_order) values ('logistics','Logistics',100);`);
const added = await tryExec(
  `insert into public.employee_module_access(user_id,section) values ('${E}','logistics')`);
ok(added === null, "granting it works immediately, with no schema change");
await as(A);
ok((await one(`select public.bos_can_access('logistics') c`)).c === true,
   "and the guard admits it");
await db.exec(`reset role; delete from public.employee_module_access where section='logistics';
               delete from public.products where key='logistics';`);

console.log("\nAn admin gets every enabled product:");
await as(A);
const adminSections = (await one(`select public.bos_my_sections() s`)).s;
ok(adminSections.length === 9, `nine without a single grant row (${adminSections.length})`);
ok((await one(`select public.bos_can_access('govern') c`)).c === true, "and may open any of them");

console.log("\nAn employee gets what they were granted, in catalogue order:");
await db.exec(`reset role;`);
await db.exec(`insert into public.employee_module_access(user_id,section) values ('${E}','govern'),('${E}','plan');`);
await as(E);
const empSections = (await one(`select public.bos_my_sections() s`)).s;
ok(empSections.length === 2 && empSections[0] === "plan" && empSections[1] === "govern",
   `sorted by the catalogue, not alphabetically (${empSections.join(", ")})`);
ok((await one(`select public.bos_can_access('plan') c`)).c === true, "may open a granted product");
ok((await one(`select public.bos_can_access('money') c`)).c === false, "and not one they were not");

console.log("\nDisabling a product takes it away from everyone, admins included:");
await db.exec(`reset role; update public.products set is_enabled=false where key='govern';`);
await as(E);
ok(!((await one(`select public.bos_my_sections() s`)).s.includes("govern")),
   "it leaves the employee nav although the grant row is untouched");
ok((await one(`select public.bos_can_access('govern') c`)).c === false, "and the guard refuses it");
await as(A);
ok(!((await one(`select public.bos_my_sections() s`)).s.includes("govern")),
   "it leaves the admin nav too");
ok((await one(`select public.bos_can_access('govern') c`)).c === false,
   "and the admin is refused as well — off means off, which is why the toggle lives on an ungated page");

console.log("\nRe-enabling restores the grant that was never deleted:");
await db.exec(`reset role; update public.products set is_enabled=true where key='govern';`);
await as(E);
ok((await one(`select public.bos_can_access('govern') c`)).c === true,
   "the employee has it back without the admin re-granting anything");

console.log("\nGranting access reports a bad key instead of a constraint violation:");
await as(A);
const msg = await tryExec(`select public.bos_set_module_access('${E}', array['plan','warehouse'])`);
ok(msg !== null && msg.includes("UNKNOWN_PRODUCT") && msg.includes("warehouse"),
   `the unknown key is named back (${(msg ?? "").split("\n")[0].slice(0, 60)})`);
ok(Number((await one(`select count(*)::int c from public.employee_module_access where user_id='${E}'`)).c) === 2,
   "and nothing was changed, so a typo cannot half-apply a grant");

console.log("\nThe rules that were already there still hold:");
await as(A);
const own = await tryExec(`select public.bos_set_module_access('${A}', array['plan'])`);
ok(own !== null && own.includes("CANNOT_EDIT_OWN_ACCESS"), "an admin still cannot edit their own access");
await as(E);
const sneak = await tryExec(`select public.bos_set_module_access('${A}', array['plan'])`);
ok(sneak !== null && sneak.includes("FORBIDDEN"), "an employee still cannot grant anything");
ok((await q(`select 1 from public.products limit 1`)).length === 1, "an employee may read the catalogue, because the nav needs it");
const write = await tryExec(`update public.products set name='Mine' where key='plan'`);
const unchanged = (await one(`select name from public.products where key='plan'`)).name;
ok(unchanged === "Plan",
   `and may not write it — the update is filtered away rather than refused, so it reports ${
     write === null ? "success" : "an error"} and changes nothing (name is still ${unchanged})`);

console.log("\nSigned out, the catalogue is not readable:");
await db.exec(`reset role; set role anon; set request.jwt.claim.sub='';`);
ok((await q(`select 1 from public.products`)).length === 0,
   "an anonymous visitor sees no products — the catalogue names internal sections");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
