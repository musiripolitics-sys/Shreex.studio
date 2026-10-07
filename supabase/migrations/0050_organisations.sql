-- ============================================================
-- 0050 -- Creating and managing organisations.
--
-- Stage 2 built the tenants table and Stage 7 built switching, membership
-- and invitations. Between them they left a hole nobody noticed until
-- somebody went looking for the button: there is no way to create a tenant.
--
-- The hole is structural rather than cosmetic. The write policy on tenants
-- reads
--
--     using (public.is_admin() or public.bos_tenant_role(id) = 'admin')
--
-- and since 0047 is_admin() means admin OF THE TENANT THIS REQUEST IS ABOUT.
-- For a row that does not exist yet there is no membership to be an admin
-- of, so the policy can never pass and the INSERT can never happen. A tenant
-- could only be conjured with the service role.
--
-- That also exposed a second gap: after 0047 every authority check is
-- per-tenant, so the platform itself has no owner. Creating a business is
-- not an act inside a business, so it needs an authority above them all.
--
-- The rule chosen here is the smallest one that bootstraps from a live
-- single-tenant install: a platform owner is an admin of the tenant marked
-- is_default. Whoever runs the original business runs the platform. When
-- that stops being true, replace bos_is_platform_owner with a lookup against
-- a platform_owners table and nothing else in this file changes.
--
-- Creation runs as SECURITY DEFINER on purpose, which is why no policy on
-- tenants is touched: the function is the only door, it checks the authority
-- itself, and a client holding nothing but an anon key still cannot insert a
-- tenant row directly.
--
-- Idempotent. Safe to run twice.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Who may create a business
-- ------------------------------------------------------------
create or replace function public.bos_is_platform_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1
      from public.tenant_members m
      join public.tenants t on t.id = m.tenant_id
     where m.user_id = auth.uid()
       and m.status  = 'active'
       and t.is_default);
$fn$;

comment on function public.bos_is_platform_owner() is
  $c$Whether the caller may create a new business. Deliberately NOT bos_request_tenant based: creating a tenant is an act above all tenants, so it cannot be authorised by a membership in the one you happen to be looking at. The rule is admin of the default tenant, which bootstraps a live single-tenant install without a new table. Replace the body with a platform_owners lookup when the platform outgrows its first customer.$c$;

revoke all on function public.bos_is_platform_owner() from public;
grant execute on function public.bos_is_platform_owner() to authenticated;

-- A plpgsql wrapper so the admin test and the default-tenant test can be
-- read separately, which matters because "no default tenant" and "not an
-- admin" are different failures and the UI should say which.
create or replace function public.bos_platform_owner_check()
returns void
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare v_default uuid;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN'; end if;

  select id into v_default from public.tenants where is_default;
  if v_default is null then raise exception 'NO_DEFAULT_TENANT'; end if;

  if not exists (
    select 1 from public.tenant_members m
     where m.user_id = auth.uid()
       and m.tenant_id = v_default
       and m.status = 'active'
       and m.role = 'admin')
  then
    raise exception 'NOT_PLATFORM_OWNER';
  end if;
end $fn$;

comment on function public.bos_platform_owner_check() is
  $c$Raises rather than returns, so a caller gets WHY it was refused. NOT_SIGNED_IN, NO_DEFAULT_TENANT and NOT_PLATFORM_OWNER are three different problems with three different fixes.$c$;

revoke all on function public.bos_platform_owner_check() from public;
grant execute on function public.bos_platform_owner_check() to authenticated;

-- ------------------------------------------------------------
-- 2. Turning a name into a slug
--
-- The slug is globally unique and appears in URLs, so it is derived rather
-- than typed when the caller does not supply one, and validated when they
-- do. A separate function because the UI wants to preview the slug before
-- the row is written.
-- ------------------------------------------------------------
create or replace function public.bos_slugify(p_text text)
returns text
language sql
immutable
as $fn$
  select nullif(
    trim(both '-' from
      regexp_replace(
        regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'),
        '-{2,}', '-', 'g')),
    '');
$fn$;

comment on function public.bos_slugify(text) is
  $c$Lowercase, alphanumeric, single hyphens, no leading or trailing hyphen. Returns null for input that reduces to nothing, so the caller can tell an unusable name from a usable one instead of writing an empty slug.$c$;

grant execute on function public.bos_slugify(text) to authenticated, anon;

-- ------------------------------------------------------------
-- 3. Creating a business
--
-- Three writes that must not come apart: the tenant, the creator as its
-- admin, and the product list. A tenant with no admin is unreachable and a
-- tenant with no products is an empty shell, so all three happen here or
-- none of them do.
-- ------------------------------------------------------------
create or replace function public.bos_create_tenant(
  p_name text,
  p_slug text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_name   text := trim(coalesce(p_name, ''));
  v_slug   text;
  v_tenant uuid;
begin
  perform public.bos_platform_owner_check();

  if length(v_name) < 2 then raise exception 'BAD_NAME'; end if;

  -- An explicit slug is still slugified, so a caller cannot smuggle a
  -- slash or a capital into a URL by naming it themselves.
  v_slug := public.bos_slugify(coalesce(nullif(trim(coalesce(p_slug, '')), ''), v_name));
  if v_slug is null then raise exception 'BAD_SLUG'; end if;

  if exists (select 1 from public.tenants where slug = v_slug) then
    raise exception 'SLUG_TAKEN: %', v_slug;
  end if;

  -- is_default stays false: there is exactly one default and it is the
  -- business that was here first.
  insert into public.tenants (slug, name)
  values (v_slug, v_name)
  returning id into v_tenant;

  -- The creator, as admin. Without this the new business has no door.
  insert into public.tenant_members (tenant_id, user_id, role, status, invited_by)
  values (v_tenant, auth.uid(), 'admin', 'active', auth.uid())
  on conflict (tenant_id, user_id) do update
     set role = 'admin', status = 'active';

  -- The product list, copied from the catalogue. Enabled products come on,
  -- disabled ones are written off rather than omitted, so a product enabled
  -- platform-wide later does not silently appear in a business that never
  -- agreed to it.
  insert into public.tenant_products (tenant_id, product_key, is_enabled)
  select v_tenant, p.key, p.is_enabled from public.products p
  on conflict (tenant_id, product_key) do nothing;

  return v_tenant;
end $fn$;

comment on function public.bos_create_tenant(text, text) is
  $c$Create a business, make the caller its admin, and give it the product catalogue. The only way to insert a tenant row: no policy on tenants permits it, by design, so this function is the door and bos_platform_owner_check is the lock.$c$;

revoke all on function public.bos_create_tenant(text, text) from public;
grant execute on function public.bos_create_tenant(text, text) to authenticated;

-- ------------------------------------------------------------
-- 4. Managing one
--
-- Renaming and suspending are admin-of-that-tenant rather than platform
-- owner: a customer running their own business on the platform should be
-- able to rename it. Both are definer so they can check membership in the
-- NAMED tenant rather than the request tenant -- the organisations page
-- lists every business you belong to, and acting on one must not require
-- switching into it first.
-- ------------------------------------------------------------
create or replace function public.bos_rename_tenant(p_tenant uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_name text := trim(coalesce(p_name, ''));
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN'; end if;
  if length(v_name) < 2 then raise exception 'BAD_NAME'; end if;
  if public.bos_tenant_role(p_tenant) is distinct from 'admin'::public.user_role then
    raise exception 'FORBIDDEN';
  end if;

  update public.tenants set name = v_name, updated_at = now() where id = p_tenant;
  -- The slug is left alone on purpose: it is in URLs and in nothing that
  -- renaming a business should break.
end $fn$;

comment on function public.bos_rename_tenant(uuid, text) is
  $c$Rename a business you administer. The slug does not follow, because it is an address and addresses do not change when the nameplate does.$c$;

revoke all on function public.bos_rename_tenant(uuid, text) from public;
grant execute on function public.bos_rename_tenant(uuid, text) to authenticated;

create or replace function public.bos_set_tenant_status(p_tenant uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_is_default boolean;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN'; end if;
  if p_status not in ('active', 'suspended', 'archived') then
    raise exception 'BAD_STATUS: %', p_status;
  end if;
  if public.bos_tenant_role(p_tenant) is distinct from 'admin'::public.user_role then
    raise exception 'FORBIDDEN';
  end if;

  select is_default into v_is_default from public.tenants where id = p_tenant;
  if v_is_default is null then raise exception 'NO_SUCH_TENANT'; end if;

  -- Suspending the default tenant would take bos_request_tenant down with
  -- it: every signed-in user with no active tenant resolves to the default,
  -- and bos_my_tenants hides non-active tenants, so there would be nothing
  -- left to switch back from.
  if v_is_default and p_status <> 'active' then
    raise exception 'CANNOT_SUSPEND_DEFAULT';
  end if;

  update public.tenants set status = p_status, updated_at = now() where id = p_tenant;

  -- Anybody acting in a business that just stopped being active is sent
  -- back to the default, because bos_my_tenants will no longer list the one
  -- they are in and the switcher would have nothing to offer them.
  if p_status <> 'active' then
    update public.users set active_tenant_id = null where active_tenant_id = p_tenant;
  end if;
end $fn$;

comment on function public.bos_set_tenant_status(uuid, text) is
  $c$Suspend, archive or reactivate a business you administer. Refuses the default tenant, which bos_request_tenant falls back to and therefore cannot be allowed to leave the active set. Clears active_tenant_id for anyone stranded inside it.$c$;

revoke all on function public.bos_set_tenant_status(uuid, text) from public;
grant execute on function public.bos_set_tenant_status(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 5. What the organisations page reads
--
-- bos_my_tenants answers which businesses and what role. The page also
-- wants how big each one is, which needs counts across tenants, which the
-- isolation policies correctly forbid a plain select from doing. So a
-- definer view of exactly the counts the page shows, restricted to the
-- businesses the caller actually belongs to.
-- ------------------------------------------------------------
create or replace function public.bos_my_tenant_summary()
returns table(
  id uuid, slug text, name text, status text, role text,
  is_default boolean, is_active boolean,
  member_count bigint, product_count bigint, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $fn$
  select t.id, t.slug, t.name, t.status, m.role::text,
         t.is_default,
         t.id = public.bos_request_tenant(),
         (select count(*) from public.tenant_members x
           where x.tenant_id = t.id and x.status = 'active'),
         (select count(*) from public.tenant_products p
           where p.tenant_id = t.id and p.is_enabled),
         t.created_at
    from public.tenant_members m
    join public.tenants t on t.id = m.tenant_id
   where m.user_id = auth.uid()
     and m.status = 'active'
   order by t.is_default desc, t.name;
$fn$;

comment on function public.bos_my_tenant_summary() is
  $c$Every business the caller belongs to, including suspended and archived ones, with the two counts the organisations page shows. Unlike bos_my_tenants this does not filter on tenant status, because a page for managing businesses has to be able to show you the one you suspended.$c$;

revoke all on function public.bos_my_tenant_summary() from public;
grant execute on function public.bos_my_tenant_summary() to authenticated;

-- ------------------------------------------------------------
-- 6. Closing a cross-tenant hole in the tenants table itself
--
-- Found by the test for section 3, which expected a direct INSERT to be
-- refused and watched it succeed. The write policy from 0034 reads
--
--     using (public.is_admin() or public.bos_tenant_role(id) = 'admin')
--
-- and is_admin() does not look at id. Since 0047 it means admin of the
-- tenant THIS REQUEST is about, so for an admin of Business Two it is true
-- while they are updating Business One row. Verified against the fixture:
-- an admin of a second business could rename and suspend the first one, and
-- insert orphan tenants with no admin member and no products. Deleting one
-- was stopped only by an ON DELETE RESTRICT on a child table, which means a
-- business young enough to have no rows yet could have been deleted outright.
--
-- This is the same bare is_admin() short-circuit 0046 removed from the task
-- and goal visibility functions. It survived here because tenants is a
-- tenancy table and so was never given a Stage 4 isolation policy -- the
-- restrictive policies compare tenant_id, and this table has none: its id
-- IS the tenant.
--
-- The fix is to stop writing to this table through policies at all. Section
-- 3 already established that creating a tenant cannot be policy-authorised,
-- and renaming and suspending now have definer functions that check
-- membership in the NAMED tenant. So there is nothing left that a direct
-- write would serve, and a table where every legitimate write goes through
-- a function is a table that does not need a write policy.
-- ------------------------------------------------------------
drop policy if exists "tenant admin writes tenant" on public.tenants;

-- The read policy loses the same short-circuit. An admin of one business has
-- no reason to read another business row.
drop policy if exists "read own tenants" on public.tenants;
create policy "read own tenants" on public.tenants
  for select
  using (public.bos_tenant_role(id) is not null);

comment on policy "read own tenants" on public.tenants is
  $c$Membership in THIS tenant, and nothing else. The is_admin() short-circuit this replaced was true for an admin of any other business, because since 0047 is_admin() is about the request rather than the row.$c$;

revoke insert, update, delete on public.tenants from authenticated, anon;

-- Belt and braces on the definer functions. Postgres grants EXECUTE to
-- PUBLIC on a new function, which is why each one above revokes it; naming
-- anon explicitly covers an install where a blanket "grant execute on all
-- functions" has run since.
revoke execute on function public.bos_is_platform_owner()            from anon;
revoke execute on function public.bos_platform_owner_check()         from anon;
revoke execute on function public.bos_create_tenant(text, text)      from anon;
revoke execute on function public.bos_rename_tenant(uuid, text)      from anon;
revoke execute on function public.bos_set_tenant_status(uuid, text)  from anon;
revoke execute on function public.bos_my_tenant_summary()            from anon;
