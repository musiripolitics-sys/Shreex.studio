/**
 * Two businesses can now hold the same code — the last part of Stage 3.
 *
 * Migration 0035 added a composite unique beside each of the 21 that would
 * collide; 0036 removes the narrow one. The only way to show that worked is
 * to create a second tenant and put the same values in both, which is also
 * the first time in this project that two tenants have existed at once.
 *
 * It matters that this is a separate suite from tenancy-stage3: that one
 * stops at 0035 and asserts the narrow constraints are STILL there, because
 * four application upserts depend on them until the deploy. This one runs the
 * whole stack.
 */
import fs from "fs";
import path from "path";
import { freshDb, counter } from "./_db.mjs";

const { state, ok } = counter();
const { db, skipped } = await freshDb();
ok(skipped.length === 0, `every migration applied cleanly (${skipped.length} failures)`);

const q = async (s) => (await db.query(s)).rows;
const one = async (s) => (await q(s))[0];
const tryExec = async (s) => { try { await db.exec(s); return null; } catch (e) { return e.message; } };

const t1 = (await one(`select id from public.tenants where is_default`)).id;
await db.exec(`insert into public.tenants(slug,name) values ('second','Second Business') on conflict (slug) do nothing;`);
const t2 = (await one(`select id from public.tenants where slug='second'`)).id;
ok(t1 !== t2, "two tenants exist");

console.log("\nThe same value in two businesses, on every kind of collision:");
const cases = [
  ["a task code",        `insert into public.tasks(code,title,tenant_id) values ('T-001','Ship it','%T%')`],
  ["a workstream key",   `insert into public.workstreams(key,name,tenant_id) values ('delivery','Delivery','%T%')`],
  ["a goal code",        `insert into public.goals(code,objective,tenant_id) values ('G-01','Grow','%T%')`],
  ["a risk code",        `insert into public.risks(code,risk,area,impact,likelihood,next_review,tenant_id) values ('R-01','Venue','Events',4,3,current_date,'%T%')`],
  ["an event slug",      `insert into public.events(slug,title,category,date,city,venue,tenant_id) values ('summit','Summit','Meetup',current_date,'Chennai','Hall','%T%')`],
  ["a city name",        `insert into public.cities(name,tenant_id) values ('Chennai','%T%')`],
  ["a promo code",       `insert into public.promo_codes(code,percent_off,tenant_id) values ('LAUNCH50',50,'%T%')`],
  ["a badge slug",       `insert into public.badges(slug,name,tenant_id) values ('first-event','First event','%T%')`],
  ["a newsletter email", `insert into public.newsletter_subscribers(email,tenant_id) values ('a@b.c','%T%')`],
  ["a campaign code",    `insert into public.campaigns(code,name,tenant_id) values ('C-01','Launch','%T%')`],
  ["a SOP code",         `insert into public.sop_documents(code,title,tenant_id) values ('SOP-01','Door open','%T%')`],
];
for (const [label, stmt] of cases) {
  // Clear whatever the seed already put there, so the test measures the
  // constraint rather than the seed.
  const table = stmt.match(/insert into public\.(\w+)/)[1];
  await db.exec(`delete from public.${table};`);
  const first  = await tryExec(stmt.replaceAll("%T%", t1));
  const second = await tryExec(stmt.replaceAll("%T%", t2));
  if (first !== null) { ok(false, `${label}: the FIRST insert failed — ${first.split("\n")[0]}`); continue; }
  ok(second === null, second === null
    ? `${label} can exist in both`
    : `${label}: the second tenant was REFUSED — ${second.split("\n")[0]}`);
}

console.log("\nBut still only once within a business:");
await db.exec(`delete from public.tasks;`);
await db.exec(`insert into public.tasks(code,title,tenant_id) values ('T-001','Ship it','${t1}');`);
const twice = await tryExec(`insert into public.tasks(code,title,tenant_id) values ('T-001','Ship it again','${t1}')`);
ok(twice !== null, "the same task code twice in one tenant is still refused");

console.log("\nOne person, two businesses, two sets of product grants:");
const U = "55555555-5555-5555-5555-555555555555";
await db.exec(`insert into auth.users(id,email) values ('${U}','u@t.c');`);
await db.exec(`update public.users set primary_role='employee' where id='${U}';`);
await db.exec(`insert into public.tenant_members(tenant_id,user_id,role,status)
               values ('${t2}','${U}','admin','active') on conflict do nothing;`);
await db.exec(`delete from public.employee_module_access;`);
const g1 = await tryExec(`insert into public.employee_module_access(user_id,section,tenant_id) values ('${U}','plan','${t1}')`);
const g2 = await tryExec(`insert into public.employee_module_access(user_id,section,tenant_id) values ('${U}','plan','${t2}')`);
ok(g1 === null && g2 === null,
   g1 === null && g2 === null
     ? "the same person can be granted Plan in both — the constraint that made this impossible was the sharpest of the 21"
     : `REFUSED: ${(g1 ?? g2 ?? "").split("\n")[0]}`);
ok(Number((await one(`select count(*)::int c from public.employee_module_access where user_id='${U}'`)).c) === 2,
   "two grant rows, one per business");

console.log("\nAnd a profile each:");
await db.exec(`delete from public.employee_profiles;`);
const p1 = await tryExec(`insert into public.employee_profiles(user_id,title,tenant_id) values ('${U}','Engineer','${t1}')`);
const p2 = await tryExec(`insert into public.employee_profiles(user_id,title,tenant_id) values ('${U}','Founder','${t2}')`);
ok(p1 === null && p2 === null,
   p1 === null && p2 === null
     ? "an engineer in one business and a founder in the other"
     : `REFUSED: ${(p1 ?? p2 ?? "").split("\n")[0]}`);

console.log("\nGranting access still works after the conflict target moved:");
const A = "11111111-1111-1111-1111-111111111111";
await db.exec(`insert into auth.users(id,email) values ('${A}','a@t.c');`);
await db.exec(`update public.users set primary_role='admin' where id='${A}';`);
await db.exec(`set role authenticated; set request.jwt.claim.sub='${A}';`);
const rpc = await tryExec(`select public.bos_set_module_access('${U}', array['plan','govern'])`);
ok(rpc === null, `bos_set_module_access runs against on conflict (tenant_id, user_id, section) (${rpc ?? "ok"})`);
await db.exec(`reset role; reset request.jwt.claim.sub;`);
ok(Number((await one(`select count(*)::int c from public.employee_module_access where user_id='${U}' and tenant_id='${t1}'`)).c) === 2,
   "and left the right grants behind");

console.log("\nEvery upsert in the application names a target the database still has:");
// The failure this catches is silent in review and loud in production: an
// onConflict naming columns with no unique index behind them fails with 42P10,
// and 0036 removed 21 such indexes. Read from the source rather than from a
// list, so a new upsert is checked too.
const uniqueTargets = new Set(
  (await q(`
    select t.relname tbl,
           (select string_agg(a.attname, ',' order by k.ord)
              from unnest(ix.indkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid=t.oid and a.attnum=k.attnum) cols
      from pg_index ix join pg_class i on i.oid=ix.indexrelid
      join pg_class t on t.oid=ix.indrelid join pg_namespace n on n.oid=t.relnamespace
     where n.nspname='public' and ix.indisunique`)).map((r) => `${r.tbl}(${r.cols})`),
);

const upserts = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (/\.tsx?$/.test(e.name)) {
      const src = fs.readFileSync(f, "utf8");
      // .from("x") ... .upsert(..., { onConflict: "a,b" }) within a few lines
      for (const m of src.matchAll(/\.from\(\s*"(\w+)"\s*\)[\s\S]{0,400}?onConflict:\s*"([^"]+)"/g)) {
        upserts.push({ file: f, table: m[1], cols: m[2].split(",").map((c) => c.trim()) });
      }
    }
  }
};
walk("src");
ok(upserts.length >= 4, `found ${upserts.length} upsert conflict targets in src`);
const broken = upserts.filter((u) => {
  const sorted = [...u.cols].sort().join(",");
  return ![...uniqueTargets].some(
    (t) => t.startsWith(`${u.table}(`) &&
      t.slice(u.table.length + 1, -1).split(",").sort().join(",") === sorted,
  );
});
ok(broken.length === 0,
   broken.length === 0
     ? `each matches a unique index: ${upserts.map((u) => `${u.table}(${u.cols.join(",")})`).join(", ")}`
     : `NO MATCHING INDEX: ${broken.map((u) => `${u.table}(${u.cols.join(",")}) in ${u.file}`).join("; ")} — this upsert fails with 42P10 at runtime`);

console.log(`\n${state.pass} passed, ${state.fail} failed`);
process.exit(state.fail ? 1 : 0);
