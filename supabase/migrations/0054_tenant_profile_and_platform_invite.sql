-- ============================================================
-- 0054 -- What a business actually is, and inviting its administrator.
--
-- Two gaps found by using the console rather than reading it.
--
-- 1. Appointing an administrator only worked for somebody who already had an
--    account. bos_assign_tenant_admin raises NO_SUCH_ACCOUNT otherwise, and
--    the advice it gave -- "invite them from inside the business" -- is advice
--    a platform owner cannot take: bos_invite_to_tenant invites into the
--    REQUEST tenant, so you would have to enter the business first, and a
--    business with no members is one you have no reason to be standing in.
--    Setting up a business for a client is precisely the case where the
--    administrator does not have an account yet. So: invite by name of tenant.
--
-- 2. A business was a name and a slug. That is enough to isolate data and not
--    enough to be a record of a business. A platform operator needs to know
--    who it is, where it is and how big it is without opening it.
--
-- Idempotent. Safe to run twice.
-- ============================================================

-- ------------------------------------------------------------
-- 1. What a business is
--
-- All nullable. A business created in a hurry during a phone call must not be
-- blocked on knowing the registered address, and a half-filled record beats a
-- business that does not exist yet.
-- ------------------------------------------------------------
alter table public.tenants
  add column if not exists website       text,
  add column if not exists contact_email text,
  add column if not exists phone         text,
  add column if not exists address       text,
  add column if not exists city          text,
  add column if not exists country       text,
  add column if not exists industry      text,
  add column if not exists employee_count int,
  add column if not exists started_on    date,
  add column if not exists notes         text;

comment on column public.tenants.employee_count is
  $c$Headcount as the business reports it, not a count of tenant_members. The two answer different questions: how big the business is, versus how many of its people use Shreex.$c$;
comment on column public.tenants.started_on is
  $c$When the BUSINESS started, not when it was added here. tenants.created_at already answers the second.$c$;

do $mig$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenants_employee_count_sane') then
    alter table public.tenants
      add constraint tenants_employee_count_sane
      check (employee_count is null or (employee_count >= 0 and employee_count < 10000000));
  end if;
end $mig$;

-- ------------------------------------------------------------
-- 2. Creating a business with its details
--
-- The profile arrives as jsonb rather than ten more arguments, so the next
-- field does not need another migration and PostgREST does not need another
-- overload. Unknown keys are ignored rather than rejected: a client sending a
-- field this version does not know about should not fail to create a business.
-- ------------------------------------------------------------
drop function if exists public.bos_create_tenant(text, text);

create or replace function public.bos_create_tenant(
  p_name    text,
  p_slug    text default null,
  p_profile jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_name   text := trim(coalesce(p_name, ''));
  v_slug   text;
  v_tenant uuid;
  v_p      jsonb := coalesce(p_profile, '{}'::jsonb);
begin
  perform public.bos_platform_owner_check();

  if length(v_name) < 2 then raise exception 'BAD_NAME'; end if;

  v_slug := public.bos_slugify(coalesce(nullif(trim(coalesce(p_slug, '')), ''), v_name));
  if v_slug is null then raise exception 'BAD_SLUG'; end if;
  if exists (select 1 from public.tenants where slug = v_slug) then
    raise exception 'SLUG_TAKEN: %', v_slug;
  end if;

  insert into public.tenants (
    slug, name, website, contact_email, phone, address, city, country,
    industry, employee_count, started_on, notes)
  values (
    v_slug, v_name,
    nullif(trim(coalesce(v_p->>'website', '')), ''),
    nullif(lower(trim(coalesce(v_p->>'contact_email', ''))), ''),
    nullif(trim(coalesce(v_p->>'phone', '')), ''),
    nullif(trim(coalesce(v_p->>'address', '')), ''),
    nullif(trim(coalesce(v_p->>'city', '')), ''),
    nullif(trim(coalesce(v_p->>'country', '')), ''),
    nullif(trim(coalesce(v_p->>'industry', '')), ''),
    -- A non-numeric employee_count is dropped rather than failing the create.
    case when (v_p->>'employee_count') ~ '^[0-9]+$'
         then (v_p->>'employee_count')::int end,
    case when (v_p->>'started_on') ~ '^\d{4}-\d{2}-\d{2}$'
         then (v_p->>'started_on')::date end,
    nullif(trim(coalesce(v_p->>'notes', '')), ''))
  returning id into v_tenant;

  -- The creator administers it until somebody else does. Without this the
  -- business has no door at all, and the platform owner is the only person
  -- who could open one.
  insert into public.tenant_members (tenant_id, user_id, role, status, invited_by)
  values (v_tenant, auth.uid(), 'admin', 'active', auth.uid())
  on conflict (tenant_id, user_id) do update
     set role = 'admin', status = 'active';

  insert into public.tenant_products (tenant_id, product_key, is_enabled)
  select v_tenant, p.key, p.is_enabled from public.products p
  on conflict (tenant_id, product_key) do nothing;

  return v_tenant;
end $fn$;

comment on function public.bos_create_tenant(text, text, jsonb) is
  $c$Create a business, make the caller its admin, and give it the product catalogue. The profile is jsonb so adding a field later needs no migration and PostgREST needs no new overload; unknown keys are ignored and a malformed number or date is dropped rather than failing the create.$c$;

revoke all on function public.bos_create_tenant(text, text, jsonb) from public, anon;
grant execute on function public.bos_create_tenant(text, text, jsonb) to authenticated;

-- ------------------------------------------------------------
-- 3. Editing those details later
-- ------------------------------------------------------------
create or replace function public.bos_update_tenant_profile(p_tenant uuid, p_profile jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_p jsonb := coalesce(p_profile, '{}'::jsonb);
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN'; end if;
  if not public.bos_is_super_admin()
     and public.bos_tenant_role(p_tenant) is distinct from 'admin'::public.user_role then
    raise exception 'FORBIDDEN';
  end if;
  if not exists (select 1 from public.tenants where id = p_tenant) then
    raise exception 'NO_SUCH_TENANT';
  end if;

  -- Only keys actually present are touched, so a form that sends three fields
  -- does not blank the other seven.
  update public.tenants set
    website        = case when v_p ? 'website'        then nullif(trim(v_p->>'website'), '')        else website end,
    contact_email  = case when v_p ? 'contact_email'  then nullif(lower(trim(v_p->>'contact_email')), '') else contact_email end,
    phone          = case when v_p ? 'phone'          then nullif(trim(v_p->>'phone'), '')          else phone end,
    address        = case when v_p ? 'address'        then nullif(trim(v_p->>'address'), '')        else address end,
    city           = case when v_p ? 'city'           then nullif(trim(v_p->>'city'), '')           else city end,
    country        = case when v_p ? 'country'        then nullif(trim(v_p->>'country'), '')        else country end,
    industry       = case when v_p ? 'industry'       then nullif(trim(v_p->>'industry'), '')       else industry end,
    employee_count = case when v_p ? 'employee_count'
                          then case when (v_p->>'employee_count') ~ '^[0-9]+$' then (v_p->>'employee_count')::int end
                          else employee_count end,
    started_on     = case when v_p ? 'started_on'
                          then case when (v_p->>'started_on') ~ '^\d{4}-\d{2}-\d{2}$' then (v_p->>'started_on')::date end
                          else started_on end,
    notes          = case when v_p ? 'notes'          then nullif(trim(v_p->>'notes'), '')          else notes end,
    updated_at     = now()
  where id = p_tenant;
end $fn$;

comment on function public.bos_update_tenant_profile(uuid, jsonb) is
  $c$Edit a business details. Only keys PRESENT in the payload are written, so a form that sends three fields does not blank the other seven -- the difference between absent and null is the whole point of using jsonb here.$c$;

revoke all on function public.bos_update_tenant_profile(uuid, jsonb) from public, anon;
grant execute on function public.bos_update_tenant_profile(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------
-- 4. Inviting an administrator who has no account yet
--
-- bos_assign_tenant_admin appoints somebody who exists. This is the other
-- half, and it is the one that matters when a business is being set up FOR
-- somebody: it writes an invitation against a NAMED tenant and returns the
-- token, which the console turns into a link to send.
--
-- Deliberately mirrors bos_invite_to_tenant, including replacing a pending
-- invitation with a fresh token, so a link that leaked stops working.
-- ------------------------------------------------------------
create or replace function public.bos_invite_to_tenant_by_id(
  p_tenant   uuid,
  p_email    text,
  p_role     text default 'admin',
  p_sections text[] default array[]::text[])
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_token uuid;
  v_bad   text;
begin
  if not public.bos_is_super_admin() then raise exception 'NOT_SUPER_ADMIN'; end if;
  if v_email = '' or position('@' in v_email) = 0 then raise exception 'BAD_EMAIL'; end if;
  if p_role not in ('admin', 'employee', 'event_host', 'community_member') then
    raise exception 'BAD_ROLE: %', p_role;
  end if;
  if not exists (select 1 from public.tenants where id = p_tenant) then
    raise exception 'NO_SUCH_TENANT';
  end if;

  select string_agg(s, ', ') into v_bad
    from unnest(coalesce(p_sections, array[]::text[])) s
   where not exists (select 1 from public.products where key = s);
  if v_bad is not null then raise exception 'UNKNOWN_PRODUCT: %', v_bad; end if;

  if exists (
    select 1 from public.tenant_members m
     join public.users u on u.id = m.user_id
    where m.tenant_id = p_tenant and m.status = 'active' and lower(u.email) = v_email)
  then
    raise exception 'ALREADY_A_MEMBER';
  end if;

  insert into public.tenant_invitations (tenant_id, email, role, sections, invited_by)
  values (p_tenant, v_email, p_role::public.user_role, coalesce(p_sections, array[]::text[]), auth.uid())
  on conflict (tenant_id, email) do update
     set role = excluded.role, sections = excluded.sections, invited_by = excluded.invited_by,
         token = gen_random_uuid(), created_at = now(),
         expires_at = now() + interval '14 days', accepted_at = null, accepted_by = null
  returning token into v_token;

  insert into public.audit_log (user_id, action, entity, entity_id, before, after, tenant_id)
  values (auth.uid(), 'invite', 'tenant_invitations', null, null,
          jsonb_build_object('email', v_email, 'role', p_role, 'via', 'super_admin'), p_tenant);

  return v_token;
end $fn$;

comment on function public.bos_invite_to_tenant_by_id(uuid, text, text, text[]) is
  $c$Invite an address into a NAMED business, without entering it. The platform half of bos_invite_to_tenant, which only ever invites into the request tenant -- advice a platform owner could not follow for a business they have no reason to be standing in. Logged in the business that gained the invitation.$c$;

revoke all on function public.bos_invite_to_tenant_by_id(uuid, text, text, text[]) from public, anon;
grant execute on function public.bos_invite_to_tenant_by_id(uuid, text, text, text[]) to authenticated;

-- ------------------------------------------------------------
-- 5. Pending invitations, for the console to show
-- ------------------------------------------------------------
create or replace function public.bos_tenant_invitations()
returns table(tenant_id uuid, id uuid, email text, role text, token uuid,
              created_at timestamptz, expires_at timestamptz, is_expired boolean)
language sql
stable
security definer
set search_path = public
as $fn$
  select i.tenant_id, i.id, i.email, i.role::text, i.token,
         i.created_at, i.expires_at, i.expires_at < now()
    from public.tenant_invitations i
   where i.accepted_at is null
     and (public.bos_is_super_admin()
          or exists (select 1 from public.tenant_members m
                      where m.tenant_id = i.tenant_id and m.user_id = auth.uid()
                        and m.status = 'active' and m.role = 'admin'))
   order by i.created_at desc;
$fn$;

comment on function public.bos_tenant_invitations() is
  $c$Pending invitations across every business the caller may manage. Carries the token, because an invitation nobody can send is not an invitation.$c$;

revoke all on function public.bos_tenant_invitations() from public, anon;
grant execute on function public.bos_tenant_invitations() to authenticated;
