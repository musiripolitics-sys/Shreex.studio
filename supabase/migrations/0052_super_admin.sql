-- ============================================================
-- 0052 -- A real Super Admin, and the end of authority by default tenant.
--
-- 0050 defined the platform owner as an admin of the tenant marked
-- is_default. That was the smallest rule that bootstrapped a live
-- single-tenant install, and it stops being usable the moment nothing is
-- default: verified in the fixture, with is_default cleared and three
-- tenants present, bos_is_platform_owner() returns false for everybody and
-- no business can be created by anyone.
--
-- So the authority becomes explicit. A row in platform_admins, not a
-- membership in a tenant that happens to be flagged. Three consequences
-- worth stating before the code:
--
-- 1. A Super Admin reaches every tenant. is_admin() becomes
--    "super admin OR admin of the request tenant", which is what makes that
--    work through the 106 policies that already call it without editing one
--    of them.
--
-- 2. Reaching is not seeing. The 87 restrictive isolation policies still
--    compare tenant_id to bos_request_tenant(), so a Super Admin sees ONE
--    business at a time -- whichever they switched into. Access to all
--    tenants means they may enter any of them, never that the data arrives
--    mixed together. Entering is logged.
--
-- 3. The tenant RECORD is platform furniture; the tenant DATA is not.
--    Renaming or suspending a business is a platform act and needs no
--    switch. Reading its tasks is not, and does.
--
-- is_default survives this migration deliberately. bos_request_tenant still
-- falls back to it for anonymous visitors, and removing that before
-- tenants.domain and host resolution exist would refuse every public form
-- submission. What it stops being is the definition of authority.
--
-- Idempotent. Safe to run twice.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Who runs the platform
--
-- A table rather than a boolean on users, for three reasons: granting it is
-- then a logged row with a grantor, a support role fits later without
-- another migration, and expires_at makes time-boxed access expressible
-- instead of permanent.
-- ------------------------------------------------------------
create table if not exists public.platform_admins (
  user_id    uuid primary key references public.users(id) on delete cascade,
  role       text not null default 'super_admin'
               check (role in ('super_admin', 'support')),
  granted_by uuid references public.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  -- Null means it does not expire. A support grant should always set one.
  expires_at timestamptz,
  note       text
);

comment on table public.platform_admins is
  $c$Who runs the platform, as opposed to who runs a business on it. Deliberately NOT a tenant membership and deliberately not a column on users: granting platform authority should leave a row saying who granted it and when, and expires_at is what makes time-boxed support access possible later without another migration.$c$;
comment on column public.platform_admins.expires_at is
  $c$Null does not expire. A support grant should always carry one -- temporary internal access that never ends is the thing this column exists to prevent.$c$;

create index if not exists platform_admins_role_idx on public.platform_admins(role);

alter table public.platform_admins enable row level security;

-- ------------------------------------------------------------
-- 2. The test
--
-- SECURITY DEFINER and it has to be: the policy on platform_admins below
-- calls this function, and a function that read the table through its own
-- policy would recurse. The same reason bos_tenant_role is definer.
-- ------------------------------------------------------------
create or replace function public.bos_is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.platform_admins a
     where a.user_id = auth.uid()
       and a.role = 'super_admin'
       and (a.expires_at is null or a.expires_at > now()));
$fn$;

comment on function public.bos_is_super_admin() is
  $c$Whether the caller runs the platform. Definer to break policy recursion on platform_admins, and answers only about auth.uid(). An expired grant is not a grant.$c$;

revoke all on function public.bos_is_super_admin() from public;
grant execute on function public.bos_is_super_admin() to authenticated;
revoke execute on function public.bos_is_super_admin() from anon;

drop policy if exists "super admin manages platform admins" on public.platform_admins;
create policy "super admin manages platform admins" on public.platform_admins
  for all
  using      (public.bos_is_super_admin() or user_id = auth.uid())
  with check (public.bos_is_super_admin());

comment on policy "super admin manages platform admins" on public.platform_admins is
  $c$A super admin manages the list; anybody may read their own row, so a support engineer can see when their own access expires. Only a super admin may write, so the list cannot be joined by the people on it.$c$;

grant select, insert, update, delete on public.platform_admins to authenticated;
revoke all on public.platform_admins from anon;

-- ------------------------------------------------------------
-- 3. Bootstrap, once
--
-- Whoever was the platform owner under the old rule becomes one under the
-- new one. Guarded on the table being empty, so running this twice does not
-- re-admit somebody who was deliberately removed.
-- ------------------------------------------------------------
do $mig$
begin
  if not exists (select 1 from public.platform_admins) then
    insert into public.platform_admins (user_id, role, note)
    select m.user_id, 'super_admin',
           'Bootstrapped by 0052 from the admins of the then-default tenant.'
      from public.tenant_members m
      join public.tenants t on t.id = m.tenant_id
     where t.is_default and m.role = 'admin' and m.status = 'active'
    on conflict (user_id) do nothing;
  end if;
end $mig$;

-- ------------------------------------------------------------
-- 4. The old name delegates to the new one
--
-- bos_is_platform_owner is referenced by a policy on public.products and by
-- the app, so it keeps its name and loses its body. One definition of who
-- runs the platform, in bos_is_super_admin.
-- ------------------------------------------------------------
create or replace function public.bos_is_platform_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select public.bos_is_super_admin();
$fn$;

comment on function public.bos_is_platform_owner() is
  $c$Kept as an alias so the policy on public.products and the app keep working. The authority moved to platform_admins in 0052; it is no longer admin of the default tenant, because nothing is default.$c$;

create or replace function public.bos_platform_owner_check()
returns void
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN'; end if;
  if not public.bos_is_super_admin() then raise exception 'NOT_SUPER_ADMIN'; end if;
end $fn$;

comment on function public.bos_platform_owner_check() is
  $c$Raises rather than returns so the caller learns why. NO_DEFAULT_TENANT is gone from the reasons, because the default tenant no longer decides anything.$c$;

-- ------------------------------------------------------------
-- 5. A Super Admin is an admin of the business they are standing in
--
-- Not of all of them at once. Pinning this to the request tenant is what
-- keeps "one business at a time" true, and it is why entering one is worth
-- logging: there is a moment to log.
-- ------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select public.bos_is_super_admin()
      or exists (
        select 1 from public.tenant_members m
         where m.user_id = auth.uid()
           and m.tenant_id = public.bos_request_tenant()
           and m.status = 'active'
           and m.role = 'admin');
$fn$;

comment on function public.is_admin() is
  $c$Whether the caller is an admin of the business this request is about -- which a super admin is, of whichever business that happens to be. The 106 policies calling this need no change for a super admin to reach every tenant, and the restrictive isolation policies still limit them to one at a time.$c$;

create or replace function public.bos_is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select public.bos_is_super_admin()
      or exists (
        select 1 from public.tenant_members m
         where m.user_id = auth.uid()
           and m.tenant_id = public.bos_request_tenant()
           and m.status = 'active'
           and m.role::text in ('admin', 'employee'));
$fn$;

-- bos_tenant_role answers about a NAMED tenant, so a super admin counts as
-- its admin only when that tenant is the one they are standing in. Without
-- the pin they could rewrite any business membership list from inside
-- another, which is the cross-tenant write 0051 closed.
create or replace function public.bos_tenant_role(p_tenant uuid)
returns public.user_role
language sql
stable
security definer
set search_path = public
as $fn$
  select case
    when public.bos_is_super_admin() and p_tenant = public.bos_request_tenant()
      then 'admin'::public.user_role
    else (select m.role from public.tenant_members m
           where m.tenant_id = p_tenant
             and m.user_id = auth.uid()
             and m.status = 'active')
  end;
$fn$;

comment on function public.bos_tenant_role(uuid) is
  $c$The caller role in a given tenant. A super admin counts as admin of the tenant they are CURRENTLY IN and no other, so managing a business data still requires entering it -- which is the event worth logging.$c$;

-- ------------------------------------------------------------
-- 6. Standing in a business you are not a member of
--
-- bos_current_tenant refused a claim the caller had no membership for,
-- which is right for everybody except the person who is allowed everywhere.
-- Without this a Super Admin cannot enter Jilo at all.
-- ------------------------------------------------------------
create or replace function public.bos_current_tenant()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_claim uuid := public.bos_claimed_tenant();
  v_super boolean := public.bos_is_super_admin();
  v       uuid;
begin
  if v_claim is not null then
    -- The token says which tenant; membership says whether that is allowed,
    -- and a super admin is allowed anywhere.
    if v_super or exists (select 1 from public.tenant_members m
                           where m.tenant_id = v_claim
                             and m.user_id = auth.uid()
                             and m.status = 'active')
    then
      return v_claim;
    end if;
    return null;
  end if;

  -- The business they last switched into, if they are still a member of it --
  -- or if they run the platform, in which case membership is beside the point.
  select u.active_tenant_id into v
    from public.users u
   where u.id = auth.uid()
     and u.active_tenant_id is not null
     and (v_super or exists (select 1 from public.tenant_members m
                              where m.tenant_id = u.active_tenant_id
                                and m.user_id = u.id
                                and m.status = 'active'));
  if v is not null then return v; end if;

  -- Their earliest membership. Unchanged from 0047 on purpose: narrowing this
  -- to "their only membership" looked tidier and broke everybody who belongs
  -- to two businesses, which the Stage 5 suite caught immediately.
  select m.tenant_id into v
    from public.tenant_members m
   where m.user_id = auth.uid() and m.status = 'active'
   order by m.joined_at, m.id
   limit 1;
  return v;
end $fn$;

comment on function public.bos_current_tenant() is
  $c$The business the caller is acting in: a token claim, else the business bos_switch_tenant wrote, else their earliest membership. A super admin may stand in any business; everybody else only in one they belong to, and a claim they have no right to is ignored rather than honoured.$c$;

-- ------------------------------------------------------------
-- 7. Switching, listing, and the log
-- ------------------------------------------------------------
create or replace function public.bos_switch_tenant(p_tenant uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_super  boolean := public.bos_is_super_admin();
  v_member boolean;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN'; end if;

  if not exists (select 1 from public.tenants
                  where id = p_tenant and status = 'active') then
    raise exception 'NO_SUCH_TENANT';
  end if;

  select exists (
    select 1 from public.tenant_members m
     where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.status = 'active')
    into v_member;

  if not (v_super or v_member) then raise exception 'NOT_A_MEMBER'; end if;

  update public.users set active_tenant_id = p_tenant where id = auth.uid();

  -- A door that opens to every business should leave a record in the
  -- business it opened. Only when the authority used was platform-level:
  -- an ordinary member switching between their own businesses is not an
  -- event anybody needs to review.
  if v_super and not v_member then
    insert into public.audit_log (user_id, action, entity, entity_id, before, after, tenant_id)
    values (auth.uid(), 'enter', 'tenants', p_tenant, null,
            jsonb_build_object('via', 'super_admin'), p_tenant);
  end if;

  return p_tenant;
end $fn$;

comment on function public.bos_switch_tenant(uuid) is
  $c$Enter a business. A member may enter their own; a super admin may enter any active one, and that is written to that business own audit log. The client names a tenant and the database decides, which is what makes active_tenant_id safe to trust.$c$;

create or replace function public.bos_my_tenants()
returns table(id uuid, slug text, name text, role text, is_active boolean)
language sql
stable
security definer
set search_path = public
as $fn$
  select t.id, t.slug, t.name,
         coalesce(m.role::text, 'super_admin'),
         t.id = public.bos_request_tenant()
    from public.tenants t
    left join public.tenant_members m
           on m.tenant_id = t.id and m.user_id = auth.uid() and m.status = 'active'
   where t.status = 'active'
     and (m.user_id is not null or public.bos_is_super_admin())
   order by t.name;
$fn$;

comment on function public.bos_my_tenants() is
  $c$The businesses the caller may enter, and which one they are in. Every active business for a super admin, their own memberships for everybody else. Deliberately not scoped to one tenant: listing them across businesses is what makes switching possible.$c$;

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
  select t.id, t.slug, t.name, t.status,
         coalesce(m.role::text, 'super_admin'),
         t.is_default,
         t.id = public.bos_request_tenant(),
         (select count(*) from public.tenant_members x
           where x.tenant_id = t.id and x.status = 'active'),
         (select count(*) from public.tenant_products p
           where p.tenant_id = t.id and p.is_enabled),
         t.created_at
    from public.tenants t
    left join public.tenant_members m
           on m.tenant_id = t.id and m.user_id = auth.uid() and m.status = 'active'
   where m.user_id is not null or public.bos_is_super_admin()
   order by t.is_default desc, t.name;
$fn$;

comment on function public.bos_my_tenant_summary() is
  $c$Every business the caller can manage, with the counts the organisations page shows. Includes suspended and archived ones, because a management page has to show you the business you suspended.$c$;

-- ------------------------------------------------------------
-- 8. The tenant record is platform furniture
--
-- Renaming or suspending a business is an act on the record, not on its
-- data, so a super admin does it from the organisations page without
-- entering the business first. Reading its tasks still requires entering.
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
  -- Written as AND ... IS DISTINCT FROM rather than NOT (... OR ... = ...)
  -- because bos_tenant_role returns NULL for a tenant the caller is not in,
  -- and "not (false or null)" is NULL -- which IF treats as false, so the
  -- guard silently falls through. A test caught exactly that: a Jilo admin
  -- renamed another business.
  if not public.bos_is_super_admin()
     and public.bos_tenant_role(p_tenant) is distinct from 'admin'::public.user_role then
    raise exception 'FORBIDDEN';
  end if;

  update public.tenants set name = v_name, updated_at = now() where id = p_tenant;
end $fn$;

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
  -- Written as AND ... IS DISTINCT FROM rather than NOT (... OR ... = ...)
  -- because bos_tenant_role returns NULL for a tenant the caller is not in,
  -- and "not (false or null)" is NULL -- which IF treats as false, so the
  -- guard silently falls through. A test caught exactly that: a Jilo admin
  -- renamed another business.
  if not public.bos_is_super_admin()
     and public.bos_tenant_role(p_tenant) is distinct from 'admin'::public.user_role then
    raise exception 'FORBIDDEN';
  end if;

  select is_default into v_is_default from public.tenants where id = p_tenant;
  if v_is_default is null then raise exception 'NO_SUCH_TENANT'; end if;

  -- Still refused while is_default is what anonymous visitors fall back to.
  -- Once tenants.domain and host resolution land this guard goes with it.
  if v_is_default and p_status <> 'active' then
    raise exception 'CANNOT_SUSPEND_DEFAULT';
  end if;

  update public.tenants set status = p_status, updated_at = now() where id = p_tenant;

  if p_status <> 'active' then
    update public.users set active_tenant_id = null where active_tenant_id = p_tenant;
  end if;
end $fn$;

-- ------------------------------------------------------------
-- 9. What this migration deliberately does NOT do
--
-- bos_seed_tenant_membership still adds every new account to the default
-- tenant. Making it a no-op belongs with the migration that removes the
-- default outright, alongside tenants.domain and host resolution, because on
-- its own it only breaks the assumption that an account has a business --
-- which the public site, and twenty existing test fixtures, both rely on.
--
-- Likewise users.primary_role and bos_mirror_primary_role survive here. They
-- lose their meaning when nothing is default, not when authority moves.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 10. Granting it, from the product rather than from SQL
--
-- The policy above already lets a super admin write platform_admins, but a
-- UI cannot use it: granting is by ADDRESS, and resolving an address to a
-- user id means reading public.users, which an admin of one business has no
-- business doing across the platform. So three definer functions, each
-- answering only what the platform administration page needs.
--
-- Without these the only way to appoint a second super admin is the SQL
-- editor, which is the exact complaint that started this work.
-- ------------------------------------------------------------
create or replace function public.bos_platform_admins()
returns table(user_id uuid, email text, full_name text, role text,
              granted_at timestamptz, expires_at timestamptz,
              granted_by_email text, is_expired boolean)
language sql
stable
security definer
set search_path = public
as $fn$
  select a.user_id, u.email, u.full_name, a.role, a.granted_at, a.expires_at,
         g.email,
         a.expires_at is not null and a.expires_at <= now()
    from public.platform_admins a
    join public.users u on u.id = a.user_id
    left join public.users g on g.id = a.granted_by
   where public.bos_is_super_admin()
   order by a.role, u.email;
$fn$;

comment on function public.bos_platform_admins() is
  $c$Who runs the platform, with the addresses a page needs to show. Returns nothing at all unless the caller is a super admin -- the where clause is the authorisation, and it is the only thing between this and a list of every platform administrator.$c$;

revoke all on function public.bos_platform_admins() from public;
grant execute on function public.bos_platform_admins() to authenticated;

create or replace function public.bos_grant_platform_admin(
  p_email   text,
  p_role    text default 'super_admin',
  p_expires timestamptz default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_user  uuid;
begin
  if not public.bos_is_super_admin() then raise exception 'NOT_SUPER_ADMIN'; end if;
  if p_role not in ('super_admin', 'support') then raise exception 'BAD_ROLE: %', p_role; end if;
  if v_email = '' or position('@' in v_email) = 0 then raise exception 'BAD_EMAIL'; end if;

  -- An address, not an id: a page should not have to know user ids, and this
  -- is the only place that resolves one across the platform.
  select id into v_user from public.users where lower(email) = v_email;
  if v_user is null then raise exception 'NO_SUCH_ACCOUNT'; end if;

  -- Support access without an end date is the thing expires_at exists to
  -- prevent, so it is required rather than merely available.
  if p_role = 'support' and p_expires is null then raise exception 'SUPPORT_NEEDS_EXPIRY'; end if;
  if p_expires is not null and p_expires <= now() then raise exception 'EXPIRY_IN_THE_PAST'; end if;

  insert into public.platform_admins (user_id, role, granted_by, expires_at)
  values (v_user, p_role, auth.uid(), p_expires)
  on conflict (user_id) do update
     set role       = excluded.role,
         granted_by = excluded.granted_by,
         granted_at = now(),
         expires_at = excluded.expires_at;

  return v_user;
end $fn$;

comment on function public.bos_grant_platform_admin(text, text, timestamptz) is
  $c$Appoint a platform administrator by address. A support grant MUST carry an expiry, because temporary internal access that never ends is what that column exists to prevent.$c$;

revoke all on function public.bos_grant_platform_admin(text, text, timestamptz) from public;
grant execute on function public.bos_grant_platform_admin(text, text, timestamptz) to authenticated;

create or replace function public.bos_revoke_platform_admin(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not public.bos_is_super_admin() then raise exception 'NOT_SUPER_ADMIN'; end if;

  -- The last super admin cannot be removed. Nobody else may write this table,
  -- so an empty one can only be repaired with the service role -- and with
  -- nothing default any more, there is no tenant to derive a new one from.
  if exists (select 1 from public.platform_admins
              where user_id = p_user and role = 'super_admin')
     and (select count(*) from public.platform_admins
           where role = 'super_admin'
             and (expires_at is null or expires_at > now())) <= 1
  then
    raise exception 'LAST_SUPER_ADMIN';
  end if;

  delete from public.platform_admins where user_id = p_user;
end $fn$;

comment on function public.bos_revoke_platform_admin(uuid) is
  $c$Remove a platform administrator. Refuses the last super admin: only a super admin may write this table, and since 0052 there is no default tenant to derive a replacement from, so an empty list needs the service role to repair.$c$;

revoke all on function public.bos_revoke_platform_admin(uuid) from public;
grant execute on function public.bos_revoke_platform_admin(uuid) to authenticated;
