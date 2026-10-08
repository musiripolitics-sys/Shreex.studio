/**
 * 0057 — a new business starts with the catalogues it needs.
 *
 * Found by seeding a real business rather than by reading code: workstreams,
 * email templates, badges and community gates were seeded by migrations into
 * whichever tenant existed at the time, which was the default one. Every
 * business created since opened with an empty roadmap and no templates, and
 * nothing errored — it just looked like a product that does not work.
 */
import { freshDb, counter } from "./_db.mjs";

const { state, ok } = counter();
const { db, skipped } = await freshDb();
ok(skipped.length === 0, `every migration applied cleanly (${skipped.length} failures)`);

const q = async (s) => (await db.query(s)).rows;
const one = async (s) => (await q(s))[0];
const tryOne = async (s) => { try { return { v: await one(s) }; } catch (e) { return { e: e.message.split("\n")[0] }; } };
const as = (u) => db.exec(`set role authenticated; set request.jwt.claim.sub='${u}'; set request.jwt.claim.role='authenticated'; reset request.jwt.claim.tenant_id;`);
const owner = () => db.exec(`reset role; reset request.jwt.claim.sub; reset request.jwt.claim.role; reset request.jwt.claim.tenant_id;`);
const n = (v) => Number(v);
const CATS = ["workstreams", "email_templates", "badges", "community_gates"];

const txf = (await one(`select id from public.tenants where is_default`)).id;
const SUP = "11111111-1111-1111-1111-111111111111";
await db.exec(`insert into auth.users(id,email) values ('${SUP}','sup@x.c');`);
await db.exec(`insert into public.platform_admins(user_id,role) values ('${SUP}','super_admin') on conflict do nothing;`);

console.log("\nThe default business has them, because the migrations seeded it:");
await owner();
const base = {};
for (const t of CATS) {
  base[t] = n((await one(`select count(*) c from public.${t} where tenant_id='${txf}'`)).c);
  ok(base[t] > 0, `${t}: ${base[t]}`);
}

console.log("\nA business created now gets the same:");
await as(SUP);
const r = await tryOne(`select public.bos_create_tenant('Jiloo','jiloo') v`);
ok(!r.e, `created (${r.e ?? "ok"})`);
const jiloo = r.v?.v?.tenant_id;
ok(!!r.v?.v?.seeded, `and the result says what was seeded (${JSON.stringify(r.v?.v?.seeded)})`);
await owner();
for (const t of CATS) {
  const c = n((await one(`select count(*) c from public.${t} where tenant_id='${jiloo}'`)).c);
  ok(c === base[t], `${t}: ${c}, matching the template (${base[t]})`);
}

console.log("\nThe copy is a copy, not a reference:");
await owner();
const w = await one(`select key, name from public.workstreams where tenant_id='${jiloo}' limit 1`);
await db.exec(`update public.workstreams set name='Renamed by Jiloo'
               where tenant_id='${jiloo}' and key='${w.key}';`);
ok((await one(`select name from public.workstreams where tenant_id='${txf}' and key='${w.key}'`)).name === w.name,
   "renaming one business's workstream leaves the other alone");

console.log("\nSeeding twice adds nothing:");
await as(SUP);
const twice = await tryOne(`select public.bos_seed_tenant_catalogues('${jiloo}') v`);
ok(!twice.e, `it runs (${twice.e ?? "ok"})`);
ok(Object.values(twice.v?.v ?? {}).every((x) => Number(x) === 0),
   `and copies nothing the second time (${JSON.stringify(twice.v?.v)})`);
await owner();
for (const t of CATS) {
  ok(n((await one(`select count(*) c from public.${t} where tenant_id='${jiloo}'`)).c) === base[t],
     `${t} is still ${base[t]}, not doubled`);
}

console.log("\nAnd it is not something any member can do to any business:");
const OUT = "22222222-2222-2222-2222-222222222222";
await db.exec(`insert into auth.users(id,email) values ('${OUT}','out@x.c');`);
await db.exec(`delete from public.tenant_members where user_id='${OUT}';`);
await as(OUT);
const bad = await tryOne(`select public.bos_seed_tenant_catalogues('${jiloo}') v`);
ok(!!bad.e && bad.e.includes("FORBIDDEN"), `an outsider is refused (${bad.e ?? "SEEDED"})`);

console.log(`\n${state.pass} passed, ${state.fail} failed`);
process.exit(state.fail ? 1 : 0);
