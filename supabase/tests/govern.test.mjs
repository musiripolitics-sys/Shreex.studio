// Govern: every record knows who owns it and what happened to it.
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
for (const f of ["schema.sql","migrations/0007_business_os.sql","migrations/0008_business_os_registries.sql","migrations/0009_business_os_reviews.sql","migrations/0010_business_os_coverage.sql","migrations/0011_business_os_chain.sql","migrations/0012_fix_dashboard_summary.sql","migrations/0015_task_comments.sql","migrations/0016_employee_access.sql","migrations/0017_staff_dashboard.sql","migrations/0018_scope_staff_reads.sql","migrations/0019_plan_section.sql","migrations/0029_govern.sql"]) await db.exec(strip(fs.readFileSync("supabase/"+f,"utf8")));
await db.exec(`alter table public.users enable row level security;`);
await db.exec(`grant usage on schema public to anon, authenticated;
  grant select, insert, update, delete on all tables in schema public to anon, authenticated;
  grant execute on all functions in schema public to anon, authenticated;
  grant usage, select on all sequences in schema public to anon, authenticated;`);

let pass=0,fail=0; const ok=(c,m)=>{c?(pass++,console.log("  ✅ "+m)):(fail++,console.log("  ❌ "+m));};
const q=async s=>(await db.query(s)).rows;
const one=async s=>(await q(s))[0];
const tryExec=async s=>{ try { await db.exec(s); return null; } catch(e){ return e.message; } };

const A="11111111-1111-1111-1111-111111111111", E="22222222-2222-2222-2222-222222222222";
await db.exec(`insert into auth.users(id,email) values ('${A}','a@t.c'),('${E}','e@t.c');`);
await db.exec(`update public.users set primary_role='admin', full_name='Ada' where id='${A}';`);
await db.exec(`update public.users set primary_role='employee', full_name='Priya' where id='${E}';`);
await db.exec(`insert into public.employee_module_access(user_id,section) values ('${E}','govern');`);
const as=u=>db.exec(`set role authenticated; set request.jwt.claim.sub='${u}';`);

console.log("\nEvery change to a governed record is recorded:");
await as(A);
await db.exec(`insert into public.risks(code,risk,area,owner_id,impact,likelihood,next_review) values ('R-01','Venue cancels late','Events','${A}',4,3,current_date - 5);`);
const risk=(await one(`select id from public.risks where code='R-01'`)).id;
await db.exec(`update public.risks set owner_id='${E}', mitigation='Hold a backup venue' where id='${risk}';`);
const changes=await q(`select field, before, after from public.govern_changes where entity='risks' and entity_id='${risk}' order by field`);
ok(changes.length===2,`two fields changed, two rows written (${changes.map(c=>c.field).join(", ")})`);
const owner=changes.find(c=>c.field==='owner_id');
ok(owner.before===A && owner.after===E,"the handover records both ends");
ok((await one(`select changed_by from public.govern_changes where entity_id='${risk}' limit 1`)).changed_by===A,"and who did it");

console.log("\nNothing that did not change is logged:");
await db.exec(`update public.risks set mitigation='Hold a backup venue' where id='${risk}';`);
ok(Number((await one(`select count(*)::int c from public.govern_changes where entity_id='${risk}'`)).c)===2,
   "writing the same value again adds nothing");

console.log("\nHistory cannot be rewritten:");
const del=await tryExec(`delete from public.govern_changes where entity_id='${risk}'`);
const still=Number((await one(`select count(*)::int c from public.govern_changes where entity_id='${risk}'`)).c);
ok(still===2,`the log survives an attempt to clear it (${still} rows)`);

console.log("\nA risk and an issue live in one register:");
ok((await one(`select kind::text k from public.risks where id='${risk}'`)).k==='risk',"defaults to risk");
await db.exec(`update public.risks set kind='issue', occurred_on=current_date where id='${risk}';`);
ok((await one(`select kind::text k from public.risks where id='${risk}'`)).k==='issue',"and becomes an issue when it happens");

console.log("\nA complaint starts its own clock:");
await db.exec(`insert into public.complaints(subject,detail,severity,complainant,contact_email,owner_id) values ('Refund not received','Paid twice',1,'Asha','a@x.c','${A}');`);
const c=await one(`select id, ref, acknowledge_by, resolve_by, state::text s from public.complaints`);
ok(!!c.ref && c.ref.startsWith("C-"),`a reference is assigned (${c.ref})`);
ok(c.acknowledge_by!==null,"an acknowledgement deadline is set");
ok(new Date(c.resolve_by) < new Date(Date.now()+3*864e5),"severity 1 gets the short resolution deadline");
await db.exec(`update public.complaints set state='investigating' where id='${c.id}';`);
ok((await one(`select acknowledged_at from public.complaints where id='${c.id}'`)).acknowledged_at!==null,
   "moving off new stamps the acknowledgement");
await db.exec(`update public.complaints set state='resolved', root_cause='Double charge on retry', resolution='Refunded' where id='${c.id}';`);
ok((await one(`select resolved_at from public.complaints where id='${c.id}'`)).resolved_at!==null,"resolving stamps the close");

console.log("\nThe data dictionary:");
await db.exec(`insert into public.data_fields(table_name,column_name,description,classification,is_personal,retention_days,owner_id) values ('registrations','attendee_email','Where the ticket is sent','personal',true,1095,'${A}');`);
const f=await one(`select classification::text c, is_personal from public.data_fields`);
ok(f.c==='personal' && f.is_personal===true,"a field can be marked as personal data with a retention period");
const dupe=await tryExec(`insert into public.data_fields(table_name,column_name) values ('registrations','attendee_email')`);
ok(dupe!==null,"and the same column cannot be catalogued twice");

console.log("\nEquipment has a custody chain:");
await db.exec(`insert into public.inventory(item,category,quantity,serial_number) values ('Scanner tablet','Equipment',1,'SN-9001');`);
const inv=(await one(`select id from public.inventory where item='Scanner tablet'`)).id;
await db.exec(`insert into public.inventory_custody(inventory_id,holder_id,condition_out) values ('${inv}','${E}','Good');`);
await db.exec(`update public.inventory set custodian_id='${E}', issued_at=now() where id='${inv}';`);
ok(Number((await one(`select count(*)::int c from public.inventory_custody where inventory_id='${inv}'`)).c)===1,
   "issuing it records who took it");
await db.exec(`update public.inventory_custody set returned_at=now(), condition_in='Screen cracked' where inventory_id='${inv}';`);
ok((await one(`select condition_in from public.inventory_custody where inventory_id='${inv}'`)).condition_in==='Screen cracked',
   "and the state it came back in");

console.log("\nDocuments keep their versions:");
await db.exec(`insert into public.assets(name,type,owner_id,version,review_date) values ('Sponsorship deck','Deck','${A}','v1',current_date - 2);`);
const asset=(await one(`select id from public.assets where name='Sponsorship deck'`)).id;
await db.exec(`insert into public.asset_versions(asset_id,version,link,note,uploaded_by) values ('${asset}','v1','http://x/1','First cut','${A}'),('${asset}','v2','http://x/2','New numbers','${A}');`);
ok(Number((await one(`select count(*)::int c from public.asset_versions where asset_id='${asset}'`)).c)===2,"two versions kept");

console.log("\nWhat needs attention, across all of it:");
// The complaint above is not late yet — severity 1 allows two days — so it
// should NOT appear. Add one that genuinely is, or the Complaint branch of
// the query is never exercised.
await db.exec(`insert into public.complaints(subject,severity,owner_id,received_at,resolve_by) values ('Ignored for a fortnight',2,'${A}',now() - interval '20 days', now() - interval '9 days');`);
const att=await q(`select area, label, days_late from public.bos_govern_attention() order by area`);
const areas=[...new Set(att.map(a=>a.area))];
ok(areas.includes("Risk") && areas.includes("Document") && areas.includes("Complaint"),
   `overdue work from every area in one list (${areas.join(", ")})`);
ok(!att.some(a=>/Refund not received/.test(a.label)),"a complaint still inside its deadline is not listed");
ok(att.every(a=>a.days_late>0),"and everything in it is genuinely late");

console.log("\nAn employee with Govern can work; one without cannot:");
await as(E);
ok(Number((await one(`select count(*)::int c from public.complaints`)).c) > 0,"Priya holds Govern, so she sees complaints");
await db.exec(`reset role;`);
await db.exec(`delete from public.employee_module_access where user_id='${E}' and section='govern';`);
await as(E);
ok(Number((await one(`select count(*)::int c from public.complaints`)).c)===0,"without it she sees none");

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail?1:0);
