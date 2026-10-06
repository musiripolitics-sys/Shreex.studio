-- ============================================================
-- Tenants, memberships, and which products each tenant has.
--
-- Stage 2 of the BOS Product Model plan. The tables exist and are seeded;
-- nothing reads them for an access decision yet. Techxfluence becomes
-- tenant #1 and every existing user becomes a member with the role they
-- already hold, so the OS behaves exactly as it does today.
--
-- Deliberately inert. No existing policy is changed, no existing function
-- is rewritten, and no row outside these three tables is touched. The point
-- of a stage that changes no behaviour is that it can be deployed on a
-- Tuesday and reviewed on a Wednesday.
--
-- The three tables carry the tenant rather than gaining one in Stage 3:
-- tenants.id IS the tenant, and the other two name it directly.
--
-- Idempotent. Run AFTER 0033.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The tenants
-- ------------------------------------------------------------
create table if not exists public.tenants (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name       text not null,
  status     text not null default 'active'
               check (status in ('active', 'suspended', 'archived')),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.tenants is
  $c$One row per business on the platform. Techxfluence is the first.$c$;
comment on column public.tenants.slug is
  $c$Globally unique on purpose: a slug identifies a tenant across the whole platform, so it is one of the few unique constraints that must NOT be scoped to a tenant.$c$;
comment on column public.tenants.is_default is
  $c$The tenant a new account joins while invitations do not exist yet. Stage 7 replaces this with an invitation flow and the flag goes away.$c$;

-- At most one default. A partial unique index rather than a CHECK, because
-- the rule is about the table rather than about a row.
create unique index if not exists tenants_one_default_idx
  on public.tenants (is_default) where is_default;

-- ------------------------------------------------------------
-- 2. Who belongs to which tenant, and as what
--
-- This is the spine. It answers both which businesses a person belongs to
-- and what they are in each one, which is why role moves here: "admin" is a
-- fact about a person IN A TENANT, not about the person.
--
-- role reuses the existing user_role enum rather than re-listing the values
-- in a CHECK. Migration 0033 removed exactly that mistake from
-- employee_module_access, and repeating it one table later would be worse
-- for knowing better.
-- ------------------------------------------------------------
create table if not exists public.tenant_members (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  user_id    uuid not null references public.users(id)   on delete cascade,
  role       public.user_role not null default 'community_member',
  -- A closed lifecycle belonging to this table, so a CHECK is right here in
  -- a way it was not for the product list: there is no registry to drift
  -- from and nothing else refers to these values.
  status     text not null default 'active'
               check (status in ('invited', 'active', 'suspended', 'ended')),
  invited_by uuid references public.users(id) on delete set null,
  joined_at  timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create index if not exists tenant_members_user_idx   on public.tenant_members(user_id);
create index if not exists tenant_members_tenant_idx on public.tenant_members(tenant_id, status);

comment on table public.tenant_members is
  $c$Membership of a tenant, and the role held in it. One person may belong to several.$c$;

-- ------------------------------------------------------------
-- 3. Which products a tenant has, and how they are configured
-- ------------------------------------------------------------
create table if not exists public.tenant_products (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  product_key text not null references public.products(key)
                on update cascade on delete cascade,
  is_enabled  boolean not null default true,
  settings    jsonb   not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, product_key)
);

create index if not exists tenant_products_tenant_idx on public.tenant_products(tenant_id);

comment on table public.tenant_products is
  $c$Which products a tenant has switched on, and the settings for each. products.is_enabled remains the platform-wide switch; this is the per-tenant one.$c$;
comment on column public.tenant_products.settings is
  $c$Read by the product that owns the key. Nothing else interprets it.$c$;

-- ------------------------------------------------------------
-- 4. updated_at
-- ------------------------------------------------------------
create or replace function public.bos_touch_row()
returns trigger language plpgsql as $fn$
begin
  new.updated_at := now();
  return new;
end $fn$;

comment on function public.bos_touch_row() is
  $c$Generic updated_at stamp. Not security definer: it needs no privilege the writer does not already hold.$c$;

do $mig$
declare t text;
begin
  foreach t in array array['tenants', 'tenant_members', 'tenant_products'] loop
    execute format('drop trigger if exists trg_%s_touch on public.%I', t, t);
    execute format(
      'create trigger trg_%s_touch before update on public.%I
         for each row execute function public.bos_touch_row()', t, t);
  end loop;
end $mig$;

-- ------------------------------------------------------------
-- 5. Two primitives
--
-- bos_tenant_role is SECURITY DEFINER and has to be. A policy on
-- tenant_members that asked "is the caller an admin of this tenant" by
-- selecting from tenant_members would recurse through its own policy
-- forever. Bypassing RLS inside the helper is what breaks the cycle, and
-- the function is filtered to auth.uid() so it can answer about nobody else.
--
-- bos_current_tenant is definer for the same reason is_admin is: it is a
-- "who am I" primitive called from inside policies, and nesting a policy
-- evaluation inside every one of them is a cost with no safety to show for
-- it. It too can only answer about the caller.
-- ------------------------------------------------------------
create or replace function public.bos_tenant_role(p_tenant uuid)
returns public.user_role
language sql
stable
security definer
set search_path = public
as $fn$
  select m.role
    from public.tenant_members m
   where m.tenant_id = p_tenant
     and m.user_id = auth.uid()
     and m.status = 'active'
   limit 1;
$fn$;

comment on function public.bos_tenant_role(uuid) is
  $c$The caller role in a given tenant, or null if they are not an active member. Definer to break policy recursion on tenant_members; answers only about auth.uid().$c$;

create or replace function public.bos_current_tenant()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare v uuid;
begin
  -- A claim in the token, once the platform mints one. Read from the token
  -- rather than from a session variable the client could set, because a
  -- parameter the client sets is a parameter the client can change.
  begin
    v := nullif(current_setting('request.jwt.claim.tenant_id', true), '')::uuid;
  exception when others then v := null;
  end;

  if v is null then
    begin
      v := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id', '')::uuid;
    exception when others then v := null;
    end;
  end if;

  -- A claim naming a tenant the caller does not belong to is ignored rather
  -- than trusted. The token says which tenant; membership says whether that
  -- is allowed.
  if v is not null then
    if exists (select 1 from public.tenant_members m
                where m.tenant_id = v and m.user_id = auth.uid() and m.status = 'active')
    then
      return v;
    end if;
    return null;
  end if;

  -- No claim yet, so the caller own membership decides. With one tenant this
  -- is always that tenant.
  select m.tenant_id into v
    from public.tenant_members m
   where m.user_id = auth.uid() and m.status = 'active'
   order by m.joined_at, m.id
   limit 1;
  return v;
end $fn$;

comment on function public.bos_current_tenant() is
  $c$The tenant the caller is acting in. A tenant_id claim in the token wins, but only if the caller is an active member of it; otherwise their single active membership. Stage 4 policies compare against this.$c$;

-- ------------------------------------------------------------
-- 6. Who may read and change the tenancy
--
-- public.is_admin() is kept alongside the tenant role throughout. It is
-- still the real authority today, and removing it here would lock the
-- existing admin out of tables they have to be able to fix. Stage 7 takes
-- it out, once role lives on the membership for every check rather than
-- only for these three tables.
-- ------------------------------------------------------------
alter table public.tenants         enable row level security;
alter table public.tenant_members  enable row level security;
alter table public.tenant_products enable row level security;

drop policy if exists "read own tenants" on public.tenants;
create policy "read own tenants" on public.tenants
  for select using (public.is_admin() or public.bos_tenant_role(id) is not null);

drop policy if exists "tenant admin writes tenant" on public.tenants;
create policy "tenant admin writes tenant" on public.tenants
  for all
  using      (public.is_admin() or public.bos_tenant_role(id) = 'admin')
  with check (public.is_admin() or public.bos_tenant_role(id) = 'admin');

drop policy if exists "read own membership" on public.tenant_members;
create policy "read own membership" on public.tenant_members
  for select using (
    user_id = auth.uid()
    or public.is_admin()
    or public.bos_tenant_role(tenant_id) = 'admin');

drop policy if exists "tenant admin manages members" on public.tenant_members;
create policy "tenant admin manages members" on public.tenant_members
  for all
  using      (public.is_admin() or public.bos_tenant_role(tenant_id) = 'admin')
  with check (public.is_admin() or public.bos_tenant_role(tenant_id) = 'admin');

drop policy if exists "members read tenant products" on public.tenant_products;
create policy "members read tenant products" on public.tenant_products
  for select using (public.is_admin() or public.bos_tenant_role(tenant_id) is not null);

drop policy if exists "tenant admin writes tenant products" on public.tenant_products;
create policy "tenant admin writes tenant products" on public.tenant_products
  for all
  using      (public.is_admin() or public.bos_tenant_role(tenant_id) = 'admin')
  with check (public.is_admin() or public.bos_tenant_role(tenant_id) = 'admin');

-- Explicit rather than relying on the default privileges Supabase sets for
-- new tables in public. They are in place today, but a migration that states
-- its own grants works on any database it is replayed against.
grant select, insert, update, delete
  on public.tenants, public.tenant_members, public.tenant_products
  to authenticated;

revoke all on function public.bos_tenant_role(uuid)  from public;
revoke all on function public.bos_current_tenant()   from public;
grant execute on function public.bos_tenant_role(uuid) to authenticated;
grant execute on function public.bos_current_tenant()  to authenticated;

-- ------------------------------------------------------------
-- 7. Techxfluence becomes tenant #1
-- ------------------------------------------------------------
insert into public.tenants (slug, name, is_default)
values ('techxfluence', 'Techxfluence', true)
on conflict (slug) do nothing;

-- Every existing account becomes a member, carrying the role it already
-- holds. primary_role is copied rather than mapped, because the column and
-- tenant_members.role are the same enum: there is no list to keep in step.
insert into public.tenant_members (tenant_id, user_id, role, status)
select t.id, u.id, u.primary_role, 'active'
  from public.users u
 cross join (select id from public.tenants where is_default) t
on conflict (tenant_id, user_id) do nothing;

-- And every product the platform has switched on.
insert into public.tenant_products (tenant_id, product_key, is_enabled)
select t.id, p.key, p.is_enabled
  from public.products p
 cross join (select id from public.tenants where is_default) t
on conflict (tenant_id, product_key) do nothing;

-- ------------------------------------------------------------
-- 8. Keep membership from rotting
--
-- Without this, an account created tomorrow has no membership, and Stage 4
-- would make every row it owns invisible to it. A separate trigger rather
-- than an edit to handle_new_user, which is Stage 5 work and carries the
-- whole signup path with it.
--
-- Temporary by design: Stage 7 replaces it with invitations, at which point
-- joining a tenant stops being automatic.
-- ------------------------------------------------------------
create or replace function public.bos_seed_tenant_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare v_tenant uuid;
begin
  select id into v_tenant from public.tenants where is_default;
  if v_tenant is null then
    return new;  -- No default tenant, so nothing to join. Not an error.
  end if;

  insert into public.tenant_members (tenant_id, user_id, role, status)
  values (v_tenant, new.id, new.primary_role, 'active')
  on conflict (tenant_id, user_id) do nothing;

  return new;
end $fn$;

drop trigger if exists trg_users_tenant_membership on public.users;
create trigger trg_users_tenant_membership after insert on public.users
  for each row execute function public.bos_seed_tenant_membership();
