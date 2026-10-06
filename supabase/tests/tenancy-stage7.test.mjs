/**
 * Stage 7 — switching between businesses, and invitations.
 *
 * The product work that makes this a platform rather than a system that could
 * be one. Two things are asserted hardest, because they are where a mistake
 * hands somebody a seat they were not given: bos_switch_tenant refusing a
 * business you do not belong to, and an invitation being to an ADDRESS rather
 * than to whoever holds the link.
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

const t1 = (await one(`select id from public.tenants where is_default`)).id;
await db.exec(`insert into public.tenants(slug,name) values ('two','Business Two');`);
const t2 = (await one(`select id from public.tenants where slug='two'`)).id;

const ADA = "11111111-1111-1111-1111-111111111111"; // admin of both
const BEN = "22222222-2222-2222-2222-222222222222"; // admin of two only
const EVE = "33333333-3333-3333-3333-333333333333"; // belongs to neither
const NEW = "44444444-4444-4444-4444-444444444444"; // the invitee
await db.exec(`insert into auth.users(id,email) values
  ('${ADA}','ada@x.c'),('${BEN}','ben@x.c'),('${EVE}','eve@x.c'),('${NEW}','newcomer@x.c');`);
await db.exec(`update public.users set primary_role='admin', full_name='Ada' where id='${ADA}';`);
await db.exec(`update public.users set primary_role='admin', full_name='Ben' where id='${BEN}';`);
await db.exec(`update public.users set full_name='Eve' where id='${EVE}';`);
await db.exec(`update public.users set full_name='Newcomer' where id='${NEW}';`);
await db.exec(`delete from public.tenant_members where user_id in ('${BEN}','${EVE}','${NEW}');`);
await db.exec(`insert into public.tenant_members(tenant_id,user_id,role,status) values
  ('${t2}','${ADA}','admin','active'), ('${t2}','${BEN}','admin','active');`);

console.log("\nA person sees the businesses they belong to, and which one they are in:");
await as(ADA);
const mine = await q(`select slug, role, is_active from public.bos_my_tenants() order by slug`);
ok(mine.length === 2, `Ada belongs to two (${mine.map((r) => r.slug).join(", ")})`);
ok(mine.filter((r) => r.is_active).length === 1, "exactly one is marked active");
await as(EVE);
ok((await q(`select slug from public.bos_my_tenants()`)).length === 0, "Eve belongs to none and sees none");

console.log("\nSwitching is refused for a business you do not belong to:");
await as(BEN);
const bad = await tryOne(`select public.bos_switch_tenant('${t1}') v`);
ok(!!bad.e && bad.e.includes("NOT_A_MEMBER"),
   `Ben cannot switch into the first business (${bad.e ?? "SWITCHED"}) — the client names a tenant, the database decides`);
await owner();
ok((await one(`select active_tenant_id from public.users where id='${BEN}'`)).active_tenant_id === null,
   "and nothing was written");

console.log("\nAnd it changes what the request is about:");
await as(ADA);
await db.exec(`select public.bos_switch_tenant('${t2}');`);
ok((await one(`select public.bos_request_tenant() v`)).v === t2, "Ada switches into the second business");
await db.exec(`select public.bos_switch_tenant('${t1}');`);
ok((await one(`select public.bos_request_tenant() v`)).v === t1, "and back to the first");

console.log("\nA claim in the token still wins over the column:");
await as(ADA);
await db.exec(`select public.bos_switch_tenant('${t1}');`);
await db.exec(`set request.jwt.claim.tenant_id='${t2}';`);
ok((await one(`select public.bos_request_tenant() v`)).v === t2,
   "the token takes precedence, so enabling a Supabase Auth Hook later changes nothing here");
await db.exec(`reset request.jwt.claim.tenant_id;`);

console.log("\nLosing a membership drops you out of that business:");
await owner();
await db.exec(`update public.users set active_tenant_id='${t2}' where id='${BEN}';`);
await db.exec(`update public.tenant_members set status='ended' where user_id='${BEN}' and tenant_id='${t2}';`);
await as(BEN);
// I expected null here and was wrong, and the real behaviour is better. With
// no membership anywhere he takes the same path as an anonymous visitor and
// lands in the default business -- which is what lets an offboarded person
// still browse the public site. Returning null would have had the restrictive
// policies deny them even a published event.
ok((await one(`select public.bos_current_tenant() v`)).v === null,
   "the stale active_tenant_id is ignored: bos_current_tenant finds no membership and answers nothing");
ok((await one(`select public.bos_request_tenant() v`)).v === t1,
   "and bos_request_tenant falls back to the default business, as it does for an anonymous visitor");
ok((await one(`select public.is_admin() v`)).v === false,
   "where he is nobody — the fallback places him, it does not grant him anything");
ok((await one(`select public.bos_is_staff() v`)).v === false, "and he is not staff there either");
await owner();
await db.exec(`update public.tenant_members set status='active' where user_id='${BEN}' and tenant_id='${t2}';`);

console.log("\nOnly an admin of the business may invite to it:");
await as(EVE);
const notAdmin = await tryOne(`select public.bos_invite_to_tenant('x@y.c') v`);
ok(!!notAdmin.e && notAdmin.e.includes("FORBIDDEN"), `Eve cannot invite (${notAdmin.e ?? "INVITED"})`);
await as(BEN);
const badRole = await tryOne(`select public.bos_invite_to_tenant('x@y.c','owner') v`);
ok(!!badRole.e && badRole.e.includes("BAD_ROLE"), `and a role that does not exist is refused (${badRole.e ?? "ACCEPTED"})`);
const badSection = await tryOne(`select public.bos_invite_to_tenant('x@y.c','employee',array['warehouse']) v`);
ok(!!badSection.e && badSection.e.includes("UNKNOWN_PRODUCT"), `as is a product that does not exist (${badSection.e ?? "ACCEPTED"})`);

console.log("\nAn invitation is to an address, not to whoever holds the link:");
await as(BEN);
const tok = (await one(`select public.bos_invite_to_tenant('newcomer@x.c','employee',array['plan','money']) v`)).v;
ok(!!tok, "Ben invites newcomer@x.c as an employee with Plan and Money");
await as(EVE);
const wrong = await tryOne(`select public.bos_accept_invitation('${tok}'::uuid) v`);
ok(!!wrong.e && wrong.e.includes("WRONG_ACCOUNT"),
   `Eve, signed in as herself, cannot accept it (${wrong.e ?? "ACCEPTED IT"}) — a forwarded link does not hand over a seat`);

console.log("\nThe invitee joins, with the role and the sections they were given:");
await as(NEW);
const accepted = (await one(`select public.bos_accept_invitation('${tok}'::uuid) v`)).v;
ok(accepted.ok === true && accepted.tenant_id === t2, `accepted into the second business (${accepted.tenant_id === t2})`);
ok(accepted.role === "employee", `as an employee (${accepted.role})`);
ok((await one(`select public.bos_request_tenant() v`)).v === t2,
   "and lands in it, rather than having to switch");
const secs = (await one(`select public.bos_my_sections() s`)).s;
ok(Array.isArray(secs) && secs.length === 2 && secs.includes("plan") && secs.includes("money"),
   `with Plan and Money granted (${JSON.stringify(secs)})`);
ok((await one(`select public.bos_is_staff() v`)).v === true, "and counts as staff there");

console.log("\nAn invitation cannot be used twice:");
await as(NEW);
const again = await tryOne(`select public.bos_accept_invitation('${tok}'::uuid) v`);
ok(!!again.e && again.e.includes("ALREADY_ACCEPTED"), `(${again.e ?? "ACCEPTED TWICE"})`);

console.log("\nRe-inviting invalidates the old link:");
await owner();
await db.exec(`delete from public.tenant_members where user_id='${NEW}' and tenant_id='${t2}';
               delete from public.tenant_invitations;`);
await as(BEN);
const first = (await one(`select public.bos_invite_to_tenant('newcomer@x.c','employee') v`)).v;
const second = (await one(`select public.bos_invite_to_tenant('newcomer@x.c','admin') v`)).v;
ok(first !== second, "a second invitation to the same address issues a new token");
await as(NEW);
const stale = await tryOne(`select public.bos_accept_invitation('${first}'::uuid) v`);
ok(!!stale.e && stale.e.includes("NO_SUCH_INVITATION"),
   `the first link no longer works (${stale.e ?? "IT STILL WORKS"}) — so a leaked invitation can be revoked by re-issuing`);
const good = (await one(`select public.bos_accept_invitation('${second}'::uuid) v`)).v;
ok(good.role === "admin", `and the second carries the role it was re-issued with (${good.role})`);

console.log("\nAn expired invitation is refused:");
await owner();
await db.exec(`delete from public.tenant_members where user_id='${NEW}' and tenant_id='${t2}';`);
await db.exec(`update public.tenant_invitations set accepted_at=null, accepted_by=null,
               expires_at = now() - interval '1 day' where email='newcomer@x.c';`);
const tok2 = (await one(`select token from public.tenant_invitations where email='newcomer@x.c'`)).token;
await as(NEW);
const expired = await tryOne(`select public.bos_accept_invitation('${tok2}'::uuid) v`);
ok(!!expired.e && expired.e.includes("INVITATION_EXPIRED"), `(${expired.e ?? "ACCEPTED AN EXPIRED ONE"})`);

console.log("\nSomebody already in the business is not invited to it again:");
await as(BEN);
const dup = await tryOne(`select public.bos_invite_to_tenant('ben@x.c') v`);
ok(!!dup.e && dup.e.includes("ALREADY_A_MEMBER"), `(${dup.e ?? "INVITED AN EXISTING MEMBER"})`);

console.log("\nInvitations are not readable across businesses:");
await owner();
await db.exec(`delete from public.tenant_invitations;`);
await as(BEN);
await db.exec(`select public.bos_invite_to_tenant('someone@x.c','employee');`);
await as(ADA);
await db.exec(`select public.bos_switch_tenant('${t1}');`);
ok((await q(`select email from public.tenant_invitations`)).length === 0,
   "Ada, acting in the first business, sees none of the second business invitations");
await db.exec(`select public.bos_switch_tenant('${t2}');`);
ok((await q(`select email from public.tenant_invitations`)).length === 1,
   "and sees it once she switches into that business");

console.log("\nThe legacy fallback is gone:");
await owner();
const src = (await one(`select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                        where n.nspname='public' and p.proname='is_admin'`)).prosrc;
ok(!/primary_role/.test(src) && !/user_roles/.test(src),
   "is_admin reads tenant_members and nothing else — no users.primary_role, no user_roles");

console.log(`\n${state.pass} passed, ${state.fail} failed`);
process.exit(state.fail ? 1 : 0);
