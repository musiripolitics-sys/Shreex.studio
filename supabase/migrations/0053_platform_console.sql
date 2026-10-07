-- ============================================================
-- 0053 -- What a platform console needs that no business page does.
--
-- A super admin who creates a business is its only admin, which is useless:
-- the point of creating one is to hand it to somebody. So the console needs
-- to appoint an administrator for a NAMED business, and to see who the
-- administrators of each business are.
--
-- This is a deliberate widening of what 0052 said, and worth being explicit
-- about. 0052 held that a super admin manages a business DATA only from
-- inside it, so that entering is logged. Appointing its administrator is not
-- its data -- it is the act of handing over the business, which is the same
-- class of thing as creating or renaming it, and a business whose only admin
-- is the platform owner cannot be handed over from inside itself without the
-- platform owner first becoming its member. So it joins the short list of
-- platform acts, and like entering, it is logged in the target business.
--
-- Idempotent. Safe to run twice.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Who administers each business
-- ------------------------------------------------------------
create or replace function public.bos_tenant_admin_list()
returns table(tenant_id uuid, user_id uuid, email text, full_name text,
              role text, joined_at timestamptz)
language sql
stable
security definer
set search_path = public
as $fn$
  select m.tenant_id, m.user_id, u.email, u.full_name, m.role::text, m.joined_at
    from public.tenant_members m
    join public.users u on u.id = m.user_id
   where m.status = 'active'
     and m.role = 'admin'
     and (public.bos_is_super_admin()
          or exists (select 1 from public.tenant_members x
                      where x.tenant_id = m.tenant_id
                        and x.user_id = auth.uid()
                        and x.status = 'active'
                        and x.role = 'admin'))
   order by m.tenant_id, u.email;
$fn$;

comment on function public.bos_tenant_admin_list() is
  $c$The administrators of every business the caller may manage: all of them for a super admin, otherwise only the businesses they administer themselves. Crosses tenants on purpose, like bos_my_tenants, because a platform console is a view across businesses by definition.$c$;

revoke all on function public.bos_tenant_admin_list() from public;
grant execute on function public.bos_tenant_admin_list() to authenticated;

-- ------------------------------------------------------------
-- 2. Handing a business to its administrator
-- ------------------------------------------------------------
create or replace function public.bos_assign_tenant_admin(
  p_tenant uuid,
  p_email  text,
  p_role   text default 'admin')
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_user  uuid;
  v_name  text;
begin
  if not public.bos_is_super_admin() then raise exception 'NOT_SUPER_ADMIN'; end if;
  if p_role not in ('admin', 'employee', 'event_host', 'community_member') then
    raise exception 'BAD_ROLE: %', p_role;
  end if;
  if v_email = '' or position('@' in v_email) = 0 then raise exception 'BAD_EMAIL'; end if;

  select name into v_name from public.tenants where id = p_tenant;
  if v_name is null then raise exception 'NO_SUCH_TENANT'; end if;

  -- An address, not an id. The console should not have to know user ids, and
  -- the account has to exist: this appoints somebody, it does not invite them.
  -- bos_invite_to_tenant is the path for an address with no account yet.
  select id into v_user from public.users where lower(email) = v_email;
  if v_user is null then raise exception 'NO_SUCH_ACCOUNT'; end if;

  insert into public.tenant_members (tenant_id, user_id, role, status, invited_by)
  values (p_tenant, v_user, p_role::public.user_role, 'active', auth.uid())
  on conflict (tenant_id, user_id) do update
     set role = excluded.role, status = 'active', updated_at = now();

  -- An admin needs every section; anybody else gets what they are granted.
  if p_role = 'admin' then
    delete from public.employee_module_access
     where user_id = v_user and tenant_id = p_tenant;
  end if;

  -- Logged in the business that gained an administrator, for the same reason
  -- entering one is: platform authority was used on somebody else business.
  insert into public.audit_log (user_id, action, entity, entity_id, before, after, tenant_id)
  values (auth.uid(), 'assign', 'tenant_members', v_user, null,
          jsonb_build_object('role', p_role, 'email', v_email, 'via', 'super_admin'),
          p_tenant);

  return v_user;
end $fn$;

comment on function public.bos_assign_tenant_admin(uuid, text, text) is
  $c$Appoint somebody to a NAMED business by address, without entering it. Super admin only, and logged in that business. A deliberate exception to the 0052 rule that a business members are managed from inside it: a business whose only admin is the platform owner cannot be handed over from inside itself, and handing it over is the point of creating it.$c$;

revoke all on function public.bos_assign_tenant_admin(uuid, text, text) from public;
grant execute on function public.bos_assign_tenant_admin(uuid, text, text) to authenticated;

-- ------------------------------------------------------------
-- 3. Taking it back
--
-- Same authority, same logging, and the same refusal bos_remove_member
-- carries: a business cannot be left with no admin, because only an admin of
-- a business may appoint one.
-- ------------------------------------------------------------
create or replace function public.bos_unassign_tenant_member(p_tenant uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_role public.user_role;
begin
  if not public.bos_is_super_admin() then raise exception 'NOT_SUPER_ADMIN'; end if;

  select role into v_role from public.tenant_members
   where tenant_id = p_tenant and user_id = p_user and status = 'active';
  if v_role is null then raise exception 'NOT_A_MEMBER'; end if;

  if v_role = 'admin' and (
    select count(*) from public.tenant_members
     where tenant_id = p_tenant and role = 'admin' and status = 'active') <= 1
  then
    raise exception 'LAST_ADMIN';
  end if;

  update public.tenant_members
     set status = 'ended', updated_at = now()
   where tenant_id = p_tenant and user_id = p_user;

  delete from public.employee_module_access
   where user_id = p_user and tenant_id = p_tenant;

  update public.users set active_tenant_id = null
   where id = p_user and active_tenant_id = p_tenant;

  insert into public.audit_log (user_id, action, entity, entity_id, before, after, tenant_id)
  values (auth.uid(), 'unassign', 'tenant_members', p_user,
          jsonb_build_object('role', v_role::text), null, p_tenant);
end $fn$;

comment on function public.bos_unassign_tenant_member(uuid, uuid) is
  $c$Remove somebody from a named business from the platform console. Refuses the last admin, for the same reason bos_remove_member does: only an admin of a business may appoint one, so a business with none needs the service role to repair.$c$;

revoke all on function public.bos_unassign_tenant_member(uuid, uuid) from public;
grant execute on function public.bos_unassign_tenant_member(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- 4. What the console shows at the top
--
-- Counts across every business, which no tenant-scoped query can produce and
-- which is the one number a platform operator actually wants.
-- ------------------------------------------------------------
create or replace function public.bos_platform_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select case when not public.bos_is_super_admin() then '{}'::jsonb else
    jsonb_build_object(
      'tenants',           (select count(*) from public.tenants),
      'tenants_active',    (select count(*) from public.tenants where status = 'active'),
      'tenants_suspended', (select count(*) from public.tenants where status <> 'active'),
      'members',           (select count(*) from public.tenant_members where status = 'active'),
      'admins',            (select count(*) from public.tenant_members where status = 'active' and role = 'admin'),
      'tenants_without_admin', (select count(*) from public.tenants t
                                 where not exists (select 1 from public.tenant_members m
                                                    where m.tenant_id = t.id
                                                      and m.status = 'active'
                                                      and m.role = 'admin')),
      'platform_admins',   (select count(*) from public.platform_admins
                             where role = 'super_admin'
                               and (expires_at is null or expires_at > now())),
      'products',          (select count(*) from public.products))
  end;
$fn$;

comment on function public.bos_platform_stats() is
  $c$Counts across every business, for the console header. Returns an empty object rather than raising for anybody who is not a super admin, so a page that forgets to guard shows nothing instead of leaking. tenants_without_admin is the one worth watching: a business in that state cannot appoint one itself.$c$;

revoke all on function public.bos_platform_stats() from public;
grant execute on function public.bos_platform_stats() to authenticated;
