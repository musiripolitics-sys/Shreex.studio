/**
 * 0054 — what a business is, and inviting its administrator.
 *
 * The invite half is the one that matters. Appointing only ever worked for
 * somebody who already had an account, and the error told a platform owner to
 * "invite them from inside the business" — advice they cannot take, because
 * bos_invite_to_tenant invites into the REQUEST tenant and a business with no
 * members is one you have no reason to be standing in. Setting up a business
 * for a client is exactly when the administrator has no account yet.
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
const TAD = "22222222-2222-2222-2222-222222222222";
await db.exec(`insert into auth.users(id,email) values ('${SUP}','sup@x.c'),('${TAD}','tad@x.c');`);
await db.exec(`insert into public.platform_admins(user_id,role) values ('${SUP}','super_admin') on conflict do nothing;`);

console.log("\nA business is more than a name and a slug:");
await as(SUP);
let r = await tryOne(`select public.bos_create_tenant('Jilo','jilo', '{
  "website":"https://jilo.example","contact_email":"Hello@Jilo.Example","city":"Chennai",
  "country":"India","industry":"Food","employee_count":"42","started_on":"2024-03-01",
  "phone":" +91 90000 00000 ","notes":"  "}'::jsonb) v`);
ok(!r.e, `created with a profile (${r.e ?? "ok"})`);
const jilo = r.v?.v?.tenant_id;
await owner();
const t = await one(`select * from public.tenants where id='${jilo}'`);
ok(t.website === "https://jilo.example" && t.city === "Chennai" && t.industry === "Food", "the details stuck");
ok(t.contact_email === "hello@jilo.example", `the contact address is lowercased (${t.contact_email})`);
ok(t.phone === "+91 90000 00000", `whitespace is trimmed (${JSON.stringify(t.phone)})`);
ok(t.notes === null, "a field containing only spaces becomes null rather than an empty string");
// Asserted in SQL rather than JavaScript: PGlite parses a date column into a
// JS Date, and String(Date) is a local-timezone rendering that can land on the
// day before. The database's own text cast has no such ambiguity.
const parsed = await one(`select employee_count, started_on::text as started from public.tenants where id='${jilo}'`);
ok(n(parsed.employee_count) === 42 && parsed.started === "2024-03-01",
   `numbers and dates are parsed (${parsed.employee_count}, ${parsed.started})`);

console.log("\nA malformed number or date is dropped, not fatal:");
await as(SUP);
r = await tryOne(`select public.bos_create_tenant('Bad Data','bad-data','{"employee_count":"lots","started_on":"March"}'::jsonb) v`);
ok(!r.e, `the business is still created (${r.e ?? "ok"}) — a typo in a count must not cost you the business`);
await owner();
const bad = await one(`select employee_count, started_on from public.tenants where slug='bad-data'`);
ok(bad.employee_count === null && bad.started_on === null, "and the unusable values are null");

console.log("\nEditing touches only what was sent:");
await as(SUP);
await tryOne(`select public.bos_update_tenant_profile('${jilo}', '{"city":"Madurai"}'::jsonb) v`);
await owner();
const after = await one(`select city, website, industry from public.tenants where id='${jilo}'`);
ok(after.city === "Madurai", `the sent field changed (${after.city})`);
ok(after.website === "https://jilo.example" && after.industry === "Food",
   "and the fields NOT sent were left alone — absent and null have to mean different things");
await as(SUP);
await tryOne(`select public.bos_update_tenant_profile('${jilo}', '{"industry":""}'::jsonb) v`);
await owner();
ok((await one(`select industry from public.tenants where id='${jilo}'`)).industry === null,
   "while sending an empty string DOES clear it");

console.log("\nInviting an administrator who has no account yet — the whole point:");
await as(SUP);
r = await tryOne(`select public.bos_assign_tenant_admin('${jilo}','newboss@jilo.example') v`);
ok(!!r.e && r.e.includes("NO_SUCH_ACCOUNT"), `appointing still refuses an unknown address (${r.e ?? "APPOINTED"})`);
r = await tryOne(`select public.bos_invite_to_tenant_by_id('${jilo}','newboss@jilo.example','admin') v`);
ok(!r.e, `but inviting them works (${r.e ?? "ok"})`);
const token = r.v?.v;
ok(!!token, "and returns a token, because an invitation nobody can send is not an invitation");
await owner();
const inv = await one(`select tenant_id, email, role::text as role from public.tenant_invitations where token='${token}'`);
ok(inv?.tenant_id === jilo && inv?.email === "newboss@jilo.example" && inv?.role === "admin",
   "against the named business, without the platform owner ever entering it");
const log = await one(`select tenant_id, action from public.audit_log where action='invite' order by created_at desc limit 1`);
ok(log?.tenant_id === jilo, "and it is logged in that business");

console.log("\nRe-inviting replaces the invitation and retires the old link:");
await as(SUP);
const again = await tryOne(`select public.bos_invite_to_tenant_by_id('${jilo}','newboss@jilo.example','admin') v`);
ok(!again.e && again.v?.v !== token, `a new token is issued (${again.v?.v !== token})`);
await owner();
ok(n((await one(`select count(*) c from public.tenant_invitations where tenant_id='${jilo}'`)).c) === 1,
   "and there is still only one invitation for that address");

console.log("\nOnly a super admin may invite into a business they are not in:");
await as(TAD);
r = await tryOne(`select public.bos_invite_to_tenant_by_id('${jilo}','someone@else.example') v`);
ok(!!r.e && r.e.includes("NOT_SUPER_ADMIN"), `a plain account is refused (${r.e ?? "INVITED"})`);
r = await tryOne(`select public.bos_update_tenant_profile('${jilo}','{"city":"Hijacked"}'::jsonb) v`);
ok(!!r.e && r.e.includes("FORBIDDEN"), `and cannot edit the business either (${r.e ?? "EDITED"})`);

console.log("\nThe console can see what is pending:");
await as(SUP);
const pending = await q(`select tenant_id, email, is_expired from public.bos_tenant_invitations()`);
ok(pending.length === 1 && pending[0].email === "newboss@jilo.example" && pending[0].is_expired === false,
   `one pending invitation, not expired (${pending.length})`);
await as(TAD);
ok((await q(`select email from public.bos_tenant_invitations()`)).length === 0,
   "and somebody who administers nothing sees none");

console.log(`\n${state.pass} passed, ${state.fail} failed`);
process.exit(state.fail ? 1 : 0);
