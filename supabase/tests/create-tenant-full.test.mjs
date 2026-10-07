/**
 * 0055 — creating a business asks what it needs and who runs it.
 *
 * The admin rule is the one worth asserting hardest. The creator becoming
 * administrator is how the super admin ended up administering Techxfluence,
 * which is a tenant like any other. Naming an administrator must mean the
 * creator does NOT hold it.
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

const SUP = "11111111-1111-1111-1111-111111111111";
const BOSS = "22222222-2222-2222-2222-222222222222";
await db.exec(`insert into auth.users(id,email) values ('${SUP}','sup@x.c'),('${BOSS}','boss@acme.com');`);
await db.exec(`insert into public.platform_admins(user_id,role) values ('${SUP}','super_admin') on conflict do nothing;`);

console.log("\nA business gets only the products it asked for:");
await as(SUP);
let r = await tryOne(`select public.bos_create_tenant('Acme','acme','{}'::jsonb, array['events','money']) v`);
ok(!r.e, `created with two products (${r.e ?? "ok"})`);
const acme = r.v?.v?.tenant_id;
await owner();
const on = await q(`select product_key from public.tenant_products where tenant_id='${acme}' and is_enabled order by 1`);
ok(on.length === 2 && on.map((x) => x.product_key).join(",") === "events,money",
   `exactly those two are on (${on.map((x) => x.product_key).join(", ")})`);
ok(n((await one(`select count(*) c from public.tenant_products where tenant_id='${acme}'`)).c) === 9,
   "and all nine have a row, so a product enabled platform-wide later cannot appear uninvited");

console.log("\nnull means every product; an empty array means none — different instructions:");
await as(SUP);
await tryOne(`select public.bos_create_tenant('All In','all-in') v`);
await tryOne(`select public.bos_create_tenant('Empty','empty','{}'::jsonb, array[]::text[]) v`);
await owner();
const all = n((await one(`select count(*) c from public.tenant_products tp join public.tenants t on t.id=tp.tenant_id where t.slug='all-in' and tp.is_enabled`)).c);
const none = n((await one(`select count(*) c from public.tenant_products tp join public.tenants t on t.id=tp.tenant_id where t.slug='empty' and tp.is_enabled`)).c);
ok(all === 9, `null gave every product (${all})`);
ok(none === 0, `an empty array gave none (${none})`);

console.log("\nA typo in the product list costs you nothing:");
await as(SUP);
r = await tryOne(`select public.bos_create_tenant('Typo','typo','{}'::jsonb, array['events','muney']) v`);
ok(!!r.e && r.e.includes("UNKNOWN_PRODUCT"), `refused before writing (${r.e ?? "CREATED"})`);
await owner();
ok(n((await one(`select count(*) c from public.tenants where slug='typo'`)).c) === 0,
   "and no half-built business was left behind");

console.log("\nNaming an administrator means the creator does NOT hold it:");
await as(SUP);
r = await tryOne(`select public.bos_create_tenant('Boss Co','boss-co','{}'::jsonb, null, 'boss@acme.com') v`);
ok(r.v?.v?.admin === "appointed", `the named account was appointed (${r.v?.v?.admin})`);
const bossco = r.v?.v?.tenant_id;
await owner();
const members = await q(`select u.email, m.role::text as role from public.tenant_members m
  join public.users u on u.id=m.user_id where m.tenant_id='${bossco}' and m.status='active'`);
ok(members.length === 1 && members[0].email === "boss@acme.com",
   `only they are in it (${members.map((m) => m.email).join(", ")})`);
ok(!members.some((m) => m.email === "sup@x.c"),
   "the platform owner is NOT an admin of it — which is the whole point");

console.log("\nAn administrator with no account yet gets an invitation, not a refusal:");
await as(SUP);
r = await tryOne(`select public.bos_create_tenant('Newco','newco','{}'::jsonb, null, 'nobody@newco.example') v`);
ok(r.v?.v?.admin === "invited", `invited rather than refused (${r.v?.v?.admin})`);
ok(!!r.v?.v?.token, "and the link comes back with the business");
await owner();
const inv = await one(`select email, role::text as role from public.tenant_invitations where token='${r.v?.v?.token}'`);
ok(inv?.email === "nobody@newco.example" && inv?.role === "admin", "as an admin invitation");
ok(n((await one(`select count(*) c from public.tenant_members m join public.tenants t on t.id=m.tenant_id where t.slug='newco' and m.status='active'`)).c) === 0,
   "and nobody is a member yet, because an invitation is not a membership");

console.log("\nNaming nobody falls back to the creator, so the business is reachable:");
await as(SUP);
r = await tryOne(`select public.bos_create_tenant('Orphan Test','orphan-test') v`);
ok(r.v?.v?.admin === "creator", `the creator holds it (${r.v?.v?.admin})`);
await owner();
ok(n((await one(`select count(*) c from public.tenant_members m join public.tenants t on t.id=m.tenant_id where t.slug='orphan-test' and m.role='admin' and m.status='active'`)).c) === 1,
   "a business with no admin could not appoint one itself, so this is the safe default");

console.log("\nAnd it is logged:");
await owner();
const log = await one(`select after from public.audit_log where action='create' and entity='tenants' order by created_at desc limit 1`);
ok(log?.after?.admin === "creator", `the audit row records how the admin was decided (${log?.after?.admin})`);

console.log(`\n${state.pass} passed, ${state.fail} failed`);
process.exit(state.fail ? 1 : 0);
