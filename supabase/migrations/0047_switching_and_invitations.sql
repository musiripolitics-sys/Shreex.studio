-- ============================================================
-- Stage 7: switching between businesses, invitations, and the end of the
-- legacy role fallback.
--
-- ------------------------------------------------------------
-- Why the active tenant is a column and not only a claim
--
-- bos_current_tenant has read a tenant_id claim since 0034, and the
-- architecture document was right that a token is a safer source than
-- anything the client sets. But Supabase only puts a custom claim in the
-- token through an Auth Hook, which is dashboard configuration rather than a
-- migration -- so relying on it alone would mean no switcher until somebody
-- enabled it.
--
-- So the claim stays FIRST and is still validated against membership, and a
-- server-side column stands behind it. users.active_tenant_id is not
-- client-supplied either: it is written only by bos_switch_tenant, which
-- refuses a tenant the caller is not an active member of. If the Auth Hook is
-- enabled later, the claim takes precedence and nothing here needs changing.
--
-- ------------------------------------------------------------
-- And why the legacy fallback can finally go
--
-- 0040 left is_admin and friends reading users.primary_role inside the
-- default tenant, because nothing kept tenant_members.role in step when an
-- account was PROMOTED -- createEmployee writes primary_role on an existing
-- account -- and reading only the membership would have silently demoted
-- whoever that happened to.
--
-- A trigger keeps them in step now, so the fallback is no longer load
-- bearing and is removed. The trigger mirrors a primary_role change onto
-- every membership that still agreed with the OLD value, which is the precise
-- rule: a role somebody deliberately set per business is left alone.
--
-- Idempotent. Run AFTER 0046.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Which business am I acting in
-- ------------------------------------------------------------
alter table public.users
  add column if not exists active_tenant_id uuid references public.tenants(id) on delete set null;

comment on column public.users.active_tenant_id is
  $c$The business this person is currently acting in. Written only by bos_switch_tenant, which refuses a tenant they are not an active member of. A tenant_id claim in the token still wins when there is one.$c$;

create or replace function public.bos_my_tenants()
returns table(id uuid, slug text, name text, role text, is_active boolean)
language sql
stable
security definer
set search_path = public
as $fn$
  select t.id, t.slug, t.name, m.role::text,
         t.id = public.bos_request_tenant()
    from public.tenant_members m
    join public.tenants t on t.id = m.tenant_id
   where m.user_id = auth.uid()
     and m.status = 'active'
     and t.status = 'active'
   order by t.name;
$fn$;

comment on function public.bos_my_tenants() is
  $c$The businesses the caller belongs to, and which one they are acting in. Deliberately NOT scoped to one tenant: listing them across tenants is what makes switching possible, which is also why tenant_members has no isolation policy.$c$;

create or replace function public.bos_switch_tenant(p_tenant uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN'; end if;

  if not exists (
    select 1 from public.tenant_members m
     join public.tenants t on t.id = m.tenant_id
    where m.tenant_id = p_tenant
      and m.user_id = auth.uid()
      and m.status = 'active'
      and t.status = 'active')
  then
    raise exception 'NOT_A_MEMBER';
  end if;

  update public.users set active_tenant_id = p_tenant where id = auth.uid();
  return p_tenant;
end $fn$;

comment on function public.bos_switch_tenant(uuid) is
  $c$Switch the caller into a business they belong to. Refuses anything else, which is what makes the column safe to trust: the client names a tenant, the database decides whether that is allowed.$c$;

-- bos_current_tenant now reads the column when the token carries no claim.
create or replace function public.bos_current_tenant()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_claim uuid := public.bos_claimed_tenant();
  v       uuid;
begin
  if v_claim is not null then
    -- The token says which tenant; membership says whether that is allowed.
    if exists (select 1 from public.tenant_members m
                where m.tenant_id = v_claim
                  and m.user_id = auth.uid()
                  and m.status = 'active')
    then
      return v_claim;
    end if;
    return null;
  end if;

  -- The business they last switched into, if they are still a member of it.
  select u.active_tenant_id into v
    from public.users u
   where u.id = auth.uid()
     and u.active_tenant_id is not null
     and exists (select 1 from public.tenant_members m
                  where m.tenant_id = u.active_tenant_id
                    and m.user_id = u.id
                    and m.status = 'active');
  if v is not null then return v; end if;

  select m.tenant_id into v
    from public.tenant_members m
   where m.user_id = auth.uid() and m.status = 'active'
   order by m.joined_at, m.id
   limit 1;
  return v;
end $fn$;

revoke all on function public.bos_my_tenants()        from public;
revoke all on function public.bos_switch_tenant(uuid) from public;
grant execute on function public.bos_my_tenants()        to authenticated;
grant execute on function public.bos_switch_tenant(uuid) to authenticated;

-- ------------------------------------------------------------
-- 2. Invitations
--
-- createEmployee makes an account with a password, which works and stays.
-- What it cannot do is add somebody who ALREADY has one -- a person who
-- registered as a member, or who works at another business on the platform.
-- An invitation is that path, and it is the only path once a person can
-- belong to several businesses.
-- ------------------------------------------------------------
create table if not exists public.tenant_invitations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  email       text not null,
  role        public.user_role not null default 'employee',
  sections    text[] not null default array[]::text[],
  token       uuid not null default gen_random_uuid(),
  invited_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references public.users(id) on delete set null,
  unique (tenant_id, email)
);

create index if not exists tenant_invitations_token_idx on public.tenant_invitations(token);
create index if not exists tenant_invitations_email_idx on public.tenant_invitations(lower(email));

comment on table public.tenant_invitations is
  $c$Pending invitations to join a business. One per address per business. The token is what the invitee presents; it is indexed because that is how it is looked up.$c$;

drop trigger if exists trg_tenant_invitations_touch on public.tenant_invitations;

alter table public.tenant_invitations enable row level security;

-- Only an admin of the business sees or writes its invitations. The invitee
-- never reads this table: they present a token to bos_accept_invitation,
-- which is definer and looks it up for them.
drop policy if exists "tenant admin manages invitations" on public.tenant_invitations;
create policy "tenant admin manages invitations" on public.tenant_invitations
  for all
  using      (public.is_admin() and tenant_id = public.bos_request_tenant())
  with check (public.is_admin() and tenant_id = public.bos_request_tenant());

grant select, insert, update, delete on public.tenant_invitations to authenticated;

create or replace function public.bos_invite_to_tenant(
  p_email text, p_role text default 'employee', p_sections text[] default array[]::text[])
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_tenant  uuid := public.bos_request_tenant();
  v_email   text := lower(trim(coalesce(p_email, '')));
  v_unknown text;
  v_token   uuid;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if v_email = '' or position('@' in v_email) = 0 then raise exception 'BAD_EMAIL'; end if;
  if p_role not in ('admin', 'employee', 'event_host', 'community_member') then
    raise exception 'BAD_ROLE: %', p_role;
  end if;

  select string_agg(s, ', ') into v_unknown
    from unnest(coalesce(p_sections, array[]::text[])) s
   where not exists (select 1 from public.products where key = s);
  if v_unknown is not null then raise exception 'UNKNOWN_PRODUCT: %', v_unknown; end if;

  -- Somebody already in this business does not need inviting to it.
  if exists (
    select 1 from public.tenant_members m
     join public.users u on u.id = m.user_id
    where m.tenant_id = v_tenant and m.status = 'active' and lower(u.email) = v_email)
  then
    raise exception 'ALREADY_A_MEMBER';
  end if;

  insert into public.tenant_invitations (tenant_id, email, role, sections, invited_by)
  values (v_tenant, v_email, p_role::public.user_role, coalesce(p_sections, array[]::text[]), auth.uid())
  on conflict (tenant_id, email) do update
     set role        = excluded.role,
         sections    = excluded.sections,
         invited_by  = excluded.invited_by,
         token       = gen_random_uuid(),
         created_at  = now(),
         expires_at  = now() + interval '14 days',
         accepted_at = null,
         accepted_by = null
  returning token into v_token;

  return v_token;
end $fn$;

comment on function public.bos_invite_to_tenant(text, text, text[]) is
  $c$Invite an address to the caller business. Re-inviting replaces the pending invitation and issues a NEW token, so a link that leaked stops working.$c$;

create or replace function public.bos_accept_invitation(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_inv   public.tenant_invitations;
  v_email text;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN'; end if;

  select * into v_inv from public.tenant_invitations
   where token = p_token for update;
  if not found then raise exception 'NO_SUCH_INVITATION'; end if;
  if v_inv.accepted_at is not null then raise exception 'ALREADY_ACCEPTED'; end if;
  if v_inv.expires_at < now() then raise exception 'INVITATION_EXPIRED'; end if;

  select lower(email) into v_email from public.users where id = auth.uid();
  -- The invitation is to an address, not to whoever holds the link.
  if v_email is distinct from lower(v_inv.email) then
    raise exception 'WRONG_ACCOUNT';
  end if;

  insert into public.tenant_members (tenant_id, user_id, role, status, invited_by)
  values (v_inv.tenant_id, auth.uid(), v_inv.role, 'active', v_inv.invited_by)
  on conflict (tenant_id, user_id) do update
     set status = 'active', role = excluded.role;

  insert into public.employee_module_access (user_id, section, granted_by, tenant_id)
  select auth.uid(), s, v_inv.invited_by, v_inv.tenant_id
    from unnest(v_inv.sections) s
  on conflict (tenant_id, user_id, section) do nothing;

  update public.tenant_invitations
     set accepted_at = now(), accepted_by = auth.uid()
   where id = v_inv.id;

  -- Land them in the business they just joined.
  update public.users set active_tenant_id = v_inv.tenant_id where id = auth.uid();

  return jsonb_build_object('ok', true, 'tenant_id', v_inv.tenant_id,
                            'role', v_inv.role::text);
end $fn$;

comment on function public.bos_accept_invitation(uuid) is
  $c$Join a business from an invitation token. The invitation is to an ADDRESS: signing in as somebody else and presenting the token is refused, so a forwarded link does not hand over a seat.$c$;

revoke all on function public.bos_invite_to_tenant(text, text, text[]) from public;
revoke all on function public.bos_accept_invitation(uuid) from public;
grant execute on function public.bos_invite_to_tenant(text, text, text[]) to authenticated;
grant execute on function public.bos_accept_invitation(uuid) to authenticated;

-- ------------------------------------------------------------
-- 3. Keep membership roles in step, then drop the legacy fallback
-- ------------------------------------------------------------
create or replace function public.bos_mirror_primary_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.primary_role is distinct from old.primary_role then
    -- Only where the membership still agreed with the old value. A role
    -- somebody set deliberately for one business is theirs to keep.
    update public.tenant_members
       set role = new.primary_role
     where user_id = new.id
       and role = old.primary_role;
  end if;
  return new;
end $fn$;

comment on function public.bos_mirror_primary_role() is
  $c$Mirrors a users.primary_role change onto every membership that still agreed with the old value. This is what made the legacy fallback in is_admin unnecessary, and it goes away with primary_role itself.$c$;

drop trigger if exists trg_users_mirror_role on public.users;
create trigger trg_users_mirror_role after update of primary_role on public.users
  for each row execute function public.bos_mirror_primary_role();

-- One last re-sync, for anything that drifted between 0040 and now.
update public.tenant_members m
   set role = u.primary_role
  from public.users u
 where u.id = m.user_id
   and m.role <> u.primary_role
   and m.tenant_id = (select id from public.tenants where is_default);

-- And now the fallback goes. Each of these read users.primary_role inside the
-- default tenant; the membership is the only authority from here.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.tenant_members m
     where m.user_id = auth.uid()
       and m.tenant_id = public.bos_request_tenant()
       and m.status = 'active'
       and m.role = 'admin');
$fn$;

comment on function public.is_admin() is
  $c$Whether the caller is an admin OF THE BUSINESS THIS REQUEST IS ABOUT. The membership is the only authority since 0047; the users.primary_role fallback is gone, kept honest by bos_mirror_primary_role.$c$;

create or replace function public.bos_is_staff()
returns boolean
language sql
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.tenant_members m
     where m.user_id = auth.uid()
       and m.tenant_id = public.bos_request_tenant()
       and m.status = 'active'
       and m.role::text in ('admin', 'employee'));
$fn$;

create or replace function public.is_host()
returns boolean
language sql
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.tenant_members m
     where m.user_id = auth.uid()
       and m.tenant_id = public.bos_request_tenant()
       and m.status = 'active'
       and m.role::text in ('event_host', 'admin'));
$fn$;
