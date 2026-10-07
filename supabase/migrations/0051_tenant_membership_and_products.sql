-- ============================================================
-- 0051 -- The flows after creating a business, and the rest of the
--         is_admin() short-circuit.
--
-- 0050 closed the hole on public.tenants and, in doing so, named the bug
-- class. The same expression is on the other two tenancy tables:
--
--     using (public.is_admin() or public.bos_tenant_role(tenant_id) = 'admin')
--
-- Since 0047 is_admin() is about the REQUEST tenant and never looks at the
-- row, so for an admin of Business Two it is true while they write Business
-- One rows. Verified in the fixture, acting as an admin of a second business:
--
--   make himself ADMIN of Business One ....... ALLOWED
--   remove the real Business One admin ....... ALLOWED
--   read the Business One roster ............. ALLOWED
--   switch off every Business One product .... ALLOWED
--
-- That is a complete takeover of any business on the platform by the admin
-- of any other. It needed a second tenant to exist, which is the very thing
-- 0050 made possible, so this must land with it rather than after it.
--
-- public.products had a third variant: writable by is_admin() with no tenant
-- in the expression at all, because the catalogue is global. An admin of one
-- business switched a product off for EVERY business. The catalogue is
-- platform furniture, so writing it becomes a platform owner act.
--
-- With those closed, the flows that creating a business implies:
--
--   - a per-business product list that is actually consulted. 0050 seeded
--     tenant_products and nothing read it, so every business showed all nine
--     products whatever its row said.
--   - changing somebody role in a business, and removing them, without
--     stranding the business with no admin.
--
-- Idempotent. Safe to run twice.
-- ============================================================

-- ------------------------------------------------------------
-- 1. tenant_members: membership in the ROW tenant, nothing else
-- ------------------------------------------------------------
drop policy if exists "read own membership" on public.tenant_members;
create policy "read own membership" on public.tenant_members
  for select
  using (user_id = auth.uid()
         or public.bos_tenant_role(tenant_id) = 'admin');

comment on policy "read own membership" on public.tenant_members is
  $c$Your own memberships anywhere, plus the whole roster of a business you administer. The is_admin() this replaced was true for an admin of any OTHER business, which let one read every roster on the platform.$c$;

drop policy if exists "tenant admin manages members" on public.tenant_members;
create policy "tenant admin manages members" on public.tenant_members
  for all
  using      (public.bos_tenant_role(tenant_id) = 'admin')
  with check (public.bos_tenant_role(tenant_id) = 'admin');

comment on policy "tenant admin manages members" on public.tenant_members is
  $c$Admin OF THE BUSINESS THE ROW IS IN. With is_admin() in here an admin of one business could insert themselves into another as admin and delete its real admin, which is a complete takeover and was reachable the moment a second business existed.$c$;

-- ------------------------------------------------------------
-- 2. tenant_products: same correction
-- ------------------------------------------------------------
drop policy if exists "members read tenant products" on public.tenant_products;
create policy "members read tenant products" on public.tenant_products
  for select
  using (public.bos_tenant_role(tenant_id) is not null);

drop policy if exists "tenant admin writes tenant products" on public.tenant_products;
create policy "tenant admin writes tenant products" on public.tenant_products
  for all
  using      (public.bos_tenant_role(tenant_id) = 'admin')
  with check (public.bos_tenant_role(tenant_id) = 'admin');

-- ------------------------------------------------------------
-- 3. The catalogue is platform furniture
--
-- products has no tenant_id and never will: it is the list of things the
-- platform sells, not a thing any one business owns. So the authority to
-- write it cannot be per-tenant either, and "admin" was the wrong test --
-- it let the admin of one business rename and disable products for all of
-- them. Reading stays open to every signed-in account, because the nav of
-- every business is built from it.
-- ------------------------------------------------------------
drop policy if exists "admin writes products" on public.products;
create policy "platform owner writes products" on public.products
  for all
  using      (public.bos_is_platform_owner())
  with check (public.bos_is_platform_owner());

comment on policy "platform owner writes products" on public.products is
  $c$The catalogue is global, so the authority to change it has to be too. Verified before this: an admin of a second business switched the events product off for every business on the platform.$c$;

-- ------------------------------------------------------------
-- 4. Give every existing business its product list
--
-- 0050 seeds this for businesses it creates. Anything that existed before
-- 0050 -- which is to say Techxfluence -- has no rows at all, and section 5
-- treats a missing row as "fall back to the catalogue", so this backfill
-- changes no behaviour. It is here so the management UI has something to
-- show per business rather than an empty list it has to explain.
-- ------------------------------------------------------------
insert into public.tenant_products (tenant_id, product_key, is_enabled)
select t.id, p.key, p.is_enabled
  from public.tenants t cross join public.products p
on conflict (tenant_id, product_key) do nothing;

-- ------------------------------------------------------------
-- 5. Make the per-business list the one that decides
--
-- A missing row means fall back to the catalogue. Absence is not "off":
-- a product added to the catalogue after a business was created has no row
-- in that business, and a brand new product appearing for everybody is the
-- behaviour that matches how the nine got there in the first place. A
-- business that does not want it switches it off, which writes the row.
-- ------------------------------------------------------------
create or replace function public.bos_product_enabled(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(
    (select tp.is_enabled from public.tenant_products tp
      where tp.tenant_id = public.bos_request_tenant()
        and tp.product_key = p_key),
    (select p.is_enabled from public.products p where p.key = p_key),
    false);
$fn$;

comment on function public.bos_product_enabled(text) is
  $c$Whether a product is on FOR THIS BUSINESS: its own row if it has one, else the catalogue, else no. The coalesce order is the whole decision -- a per-business row wins, absence defers, an unknown key is refused rather than allowed.$c$;

revoke all on function public.bos_product_enabled(text) from public;
grant execute on function public.bos_product_enabled(text) to authenticated;

-- bos_can_access now asks that question instead of reading the catalogue
-- directly. Everything else about it is unchanged, including the tenant
-- predicate on employee_module_access that Stage 5 added.
create or replace function public.bos_can_access(p_section text)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select public.bos_product_enabled(p_section)
     and (
           public.is_admin()
        or exists (
             select 1 from public.employee_module_access
              where user_id = auth.uid() and section = p_section
                and tenant_id = public.bos_request_tenant())
         );
$fn$;

comment on function public.bos_can_access(text) is
  $c$Whether the caller may open a product in the business this request is about. A product switched off for that business is refused to everyone, admins included -- which is what makes a per-business product list mean something rather than only hiding nav entries.$c$;

-- And the section list the nav is built from.
create or replace function public.bos_my_sections()
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if auth.uid() is null then
    return array[]::text[];
  end if;

  if public.is_admin() then
    return coalesce(
      (select array_agg(p.key order by p.sort_order, p.key)
         from public.products p
        where public.bos_product_enabled(p.key)),
      array[]::text[]);
  end if;

  return coalesce(
    (select array_agg(p.key order by p.sort_order, p.key)
       from public.employee_module_access a
       join public.products p on p.key = a.section
      where a.user_id = auth.uid()
        and a.tenant_id = public.bos_request_tenant()
        and public.bos_product_enabled(p.key)),
    array[]::text[]);
end $fn$;

comment on function public.bos_my_sections() is
  $c$The products the caller may open in this business. Filters on bos_product_enabled rather than products.is_enabled since 0051, so switching a product off for one business removes it from that business nav and no other.$c$;

-- What the management UI reads: the catalogue with this business answer
-- against each row, including the products it has no row for.
create or replace function public.bos_tenant_products()
returns table(key text, name text, description text, sort_order int,
              catalogue_enabled boolean, tenant_enabled boolean, has_row boolean)
language sql
stable
security definer
set search_path = public
as $fn$
  select p.key, p.name, p.description, p.sort_order,
         p.is_enabled,
         public.bos_product_enabled(p.key),
         exists (select 1 from public.tenant_products tp
                  where tp.tenant_id = public.bos_request_tenant()
                    and tp.product_key = p.key)
    from public.products p
   order by p.sort_order, p.key;
$fn$;

comment on function public.bos_tenant_products() is
  $c$The catalogue as this business sees it. has_row distinguishes a deliberate choice from a default, so the UI can say "following the catalogue" rather than claiming a decision nobody made.$c$;

revoke all on function public.bos_tenant_products() from public;
grant execute on function public.bos_tenant_products() to authenticated;

create or replace function public.bos_set_tenant_product(p_key text, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_tenant uuid := public.bos_request_tenant();
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if v_tenant is null then raise exception 'NO_TENANT'; end if;
  if not exists (select 1 from public.products where key = p_key) then
    raise exception 'UNKNOWN_PRODUCT: %', p_key;
  end if;

  insert into public.tenant_products (tenant_id, product_key, is_enabled)
  values (v_tenant, p_key, p_enabled)
  on conflict (tenant_id, product_key) do update
     set is_enabled = excluded.is_enabled, updated_at = now();
end $fn$;

comment on function public.bos_set_tenant_product(text, boolean) is
  $c$Switch a product on or off for the business the caller is acting in. Writes the row either way, so a choice to match the catalogue is recorded as a choice and stops tracking it.$c$;

revoke all on function public.bos_set_tenant_product(text, boolean) from public;
grant execute on function public.bos_set_tenant_product(text, boolean) to authenticated;

-- ------------------------------------------------------------
-- 6. Changing somebody role in a business, and removing them
--
-- Both refuse to leave a business with no admin. That is not politeness:
-- every write policy on tenant_members now requires an admin of that
-- business, so a business whose last admin steps down cannot appoint
-- another one. It would need the service role to recover.
-- ------------------------------------------------------------
create or replace function public.bos_set_member_role(p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_tenant uuid := public.bos_request_tenant();
  v_was    public.user_role;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if v_tenant is null then raise exception 'NO_TENANT'; end if;
  if p_role not in ('admin', 'employee', 'event_host', 'community_member') then
    raise exception 'BAD_ROLE: %', p_role;
  end if;

  select role into v_was from public.tenant_members
   where tenant_id = v_tenant and user_id = p_user and status = 'active';
  if v_was is null then raise exception 'NOT_A_MEMBER'; end if;
  if v_was::text = p_role then return; end if;

  if v_was = 'admin' and p_role <> 'admin' and (
    select count(*) from public.tenant_members
     where tenant_id = v_tenant and role = 'admin' and status = 'active') <= 1
  then
    raise exception 'LAST_ADMIN';
  end if;

  update public.tenant_members
     set role = p_role::public.user_role, updated_at = now()
   where tenant_id = v_tenant and user_id = p_user;
end $fn$;

comment on function public.bos_set_member_role(uuid, text) is
  $c$Change what somebody is in the business the caller is acting in. Refuses to demote the last admin, because since 0051 only an admin of a business may appoint one and a business with none would need the service role to recover.$c$;

revoke all on function public.bos_set_member_role(uuid, text) from public;
grant execute on function public.bos_set_member_role(uuid, text) to authenticated;

create or replace function public.bos_remove_member(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_tenant uuid := public.bos_request_tenant();
  v_role   public.user_role;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if v_tenant is null then raise exception 'NO_TENANT'; end if;

  select role into v_role from public.tenant_members
   where tenant_id = v_tenant and user_id = p_user and status = 'active';
  if v_role is null then raise exception 'NOT_A_MEMBER'; end if;

  if v_role = 'admin' and (
    select count(*) from public.tenant_members
     where tenant_id = v_tenant and role = 'admin' and status = 'active') <= 1
  then
    raise exception 'LAST_ADMIN';
  end if;

  -- Ended rather than deleted. The membership is what every historical row
  -- in this business was written under, and a deleted one makes an audit
  -- entry unreadable. bos_my_tenants and bos_tenant_role both test for
  -- active, so ended is already invisible everywhere it matters.
  update public.tenant_members
     set status = 'ended', updated_at = now()
   where tenant_id = v_tenant and user_id = p_user;

  -- Their section grants in THIS business go with them. Grants in another
  -- business are not this business to revoke.
  delete from public.employee_module_access
   where user_id = p_user and tenant_id = v_tenant;

  -- And they stop standing in a business they are no longer in.
  update public.users set active_tenant_id = null
   where id = p_user and active_tenant_id = v_tenant;
end $fn$;

comment on function public.bos_remove_member(uuid) is
  $c$Remove somebody from the business the caller is acting in: membership ended rather than deleted, section grants in this business dropped, and sent back to the default if they were standing here. Refuses the last admin.$c$;

revoke all on function public.bos_remove_member(uuid) from public;
grant execute on function public.bos_remove_member(uuid) to authenticated;

-- ------------------------------------------------------------
-- 7. Letting an invitee see what they are being asked to join
--
-- The policy from 0047 reads
--
--     using (public.is_admin() and tenant_id = public.bos_request_tenant())
--
-- which is correct for managing invitations and leaves the invitee unable to
-- read their own. So an accept page could offer nothing but a bare Accept
-- button, and bos_accept_invitation raising WRONG_ACCOUNT could not say what
-- the right account was.
--
-- A definer read, keyed on the token. The token is already the secret, so
-- revealing what it is for reveals nothing a holder did not receive, and the
-- invited address has to come back or the page cannot explain the refusal.
-- Nothing about any other invitation is reachable: one token, one row.
-- ------------------------------------------------------------
create or replace function public.bos_invitation_preview(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v record;
  v_me text;
begin
  select i.email, i.role::text as role, i.sections, i.expires_at, i.accepted_at,
         t.name as tenant_name, t.status as tenant_status
    into v
    from public.tenant_invitations i
    join public.tenants t on t.id = i.tenant_id
   where i.token = p_token;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  select lower(email) into v_me from public.users where id = auth.uid();

  return jsonb_build_object(
    'found',        true,
    'tenant_name',  v.tenant_name,
    'tenant_ok',    v.tenant_status = 'active',
    'role',         v.role,
    'sections',     to_jsonb(v.sections),
    'email',        v.email,
    'expired',      v.expires_at < now(),
    'accepted',     v.accepted_at is not null,
    -- Null when nobody is signed in, so the page can ask them to sign in
    -- rather than wrongly telling them it is the wrong account.
    'is_you',       case when v_me is null then null
                         else v_me = lower(v.email) end);
end $fn$;

comment on function public.bos_invitation_preview(uuid) is
  $c$What a token is an invitation to, for the accept page. One token, one row, and nothing about any other invitation is reachable. The invited address comes back because without it the page cannot explain a WRONG_ACCOUNT refusal; the holder received that address anyway.$c$;

revoke all on function public.bos_invitation_preview(uuid) from public;
-- anon too: somebody following the link before signing in should be told what
-- it is for and asked to sign in, rather than shown nothing.
grant execute on function public.bos_invitation_preview(uuid) to authenticated, anon;
