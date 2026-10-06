-- ============================================================
-- Products as data.
--
-- Stage 1 of the BOS Product Model plan. Until now a product was a
-- TypeScript constant: SECTION_KEYS in src/lib/os-access.ts, repeated in
-- src/app/admin/os/actions.ts, and written a third time as a CHECK
-- constraint on employee_module_access.section. Three copies of one list,
-- and nothing to stop them drifting apart.
--
-- This makes the registry a table. A product can now be turned off for the
-- whole install, which is the smallest useful version of what Stage 2 turns
-- into per-tenant enablement.
--
-- What this does NOT do: it does not make a product pages. A product
-- exists and is enabled as data; its routes stay code, because a page is a
-- React component and no registry can conjure one. The nine keys here are
-- exactly the nine the app has pages for.
--
-- No new SECURITY DEFINER function. The catalogue is read with an ordinary
-- select under RLS, deliberately, because every definer function added is a
-- function Stage 5 has to audit.
--
-- Idempotent. Run AFTER 0016.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The catalogue
-- ------------------------------------------------------------
create table if not exists public.products (
  key         text primary key,
  name        text not null,
  description text,
  surface     text not null default 'os'
                check (surface in ('os', 'public', 'both')),
  sort_order  int not null default 0,
  is_enabled  boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.products is
  $c$The product catalogue. One row per grantable section of the OS. Global for now; Stage 2 adds tenant_products to say which tenant has which.$c$;
comment on column public.products.key is
  $c$Stable identifier. Referenced by employee_module_access.section and by requireSection in the app, so it is never renamed.$c$;
comment on column public.products.surface is
  $c$Where the product appears: os (admin only), public (the website), both.$c$;
comment on column public.products.is_enabled is
  $c$Off means off for everyone, admins included. The toggle lives on the ungated access page so disabling a product cannot lock an admin out of re-enabling it.$c$;

-- Seeded from the nine keys the app has pages for. on conflict do nothing,
-- so re-running never overwrites a name an admin has edited.
insert into public.products (key, name, description, surface, sort_order) values
  ('plan',      'Plan',      'Goals, roadmap, tasks, dependencies, the calendar and reviews.',        'os', 10),
  ('events',    'Events',    'Events, hosts, tickets, the door scanner, and SOPs.',                   'both', 20),
  ('money',     'Money',     'Finance, expenses, revenue, budgets and vendors.',                      'os', 30),
  ('grow',      'Grow',      'Membership, CRM, partnerships, influencers and ambassadors.',           'both', 40),
  ('marketing', 'Marketing', 'Campaigns, content, the podcast and competitor tracking.',              'os', 50),
  ('team',      'Team',      'People, hiring and employee KPIs.',                                     'os', 60),
  ('product',   'Product',   'Product modules and customer feedback.',                                'os', 70),
  ('govern',    'Govern',    'Risks, complaints, legal, the data dictionary, assets and inventory.',   'os', 80),
  ('insights',  'Insights',  'Analytics and reports.',                                                'os', 90)
on conflict (key) do nothing;

create or replace function public.bos_touch_products()
returns trigger language plpgsql as $fn$
begin
  new.updated_at := now();
  return new;
end $fn$;

drop trigger if exists trg_products_touch on public.products;
create trigger trg_products_touch before update on public.products
  for each row execute function public.bos_touch_products();

-- ------------------------------------------------------------
-- 2. Who may read and change it
--
-- Everyone signed in reads the catalogue, because the nav has to render.
-- Only an admin writes it.
-- ------------------------------------------------------------
alter table public.products enable row level security;

drop policy if exists "read products" on public.products;
create policy "read products" on public.products
  for select using (auth.uid() is not null);

drop policy if exists "admin writes products" on public.products;
create policy "admin writes products" on public.products
  for all using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- 3. The grant table stops knowing the nine names
--
-- The CHECK constraint listed them in SQL. Replacing it with a foreign key
-- means the database learns the list from the catalogue, so adding a tenth
-- product is an insert rather than a migration.
-- ------------------------------------------------------------
alter table public.employee_module_access
  drop constraint if exists employee_module_access_section_check;

do $mig$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'employee_module_access_section_fkey'
       and conrelid = 'public.employee_module_access'::regclass
  ) then
    alter table public.employee_module_access
      add constraint employee_module_access_section_fkey
      foreign key (section) references public.products(key)
      on update cascade on delete cascade;
  end if;
end $mig$;

-- ------------------------------------------------------------
-- 4. The access functions read the catalogue
--
-- bos_my_sections previously declared the nine in a local array. It now
-- reads them, and intersects an employee grant with what is enabled, so
-- turning a product off removes it from every nav without touching grants.
-- ------------------------------------------------------------
create or replace function public.bos_my_sections()
returns text[]
language plpgsql
security definer
stable
set search_path = public
as $fn$
begin
  if auth.uid() is null then
    return array[]::text[];
  end if;

  -- An admin always has every enabled product, granted or not.
  if public.is_admin() then
    return coalesce(
      (select array_agg(key order by sort_order, key)
         from public.products where is_enabled),
      array[]::text[]);
  end if;

  return coalesce(
    (select array_agg(p.key order by p.sort_order, p.key)
       from public.employee_module_access a
       join public.products p on p.key = a.section
      where a.user_id = auth.uid()
        and p.is_enabled),
    array[]::text[]);
end $fn$;

comment on function public.bos_my_sections() is
  $c$Product keys the signed-in user may open, in catalogue order. Admins get every enabled product. A disabled product is returned to nobody.$c$;

create or replace function public.bos_can_access(p_section text)
returns boolean
language sql
security definer
stable
set search_path = public
as $fn$
  select exists (
           select 1 from public.products
            where key = p_section and is_enabled
         )
     and (
           public.is_admin()
        or exists (
             select 1 from public.employee_module_access
              where user_id = auth.uid() and section = p_section)
         );
$fn$;

comment on function public.bos_can_access(text) is
  $c$Whether the caller may open a product. A disabled product is refused to everyone, admins included.$c$;

-- ------------------------------------------------------------
-- 5. Granting access validates against the catalogue
--
-- Without this the foreign key raises a constraint violation, which reaches
-- the admin as a wall of Postgres. Checking first gives them the key that
-- was wrong.
-- ------------------------------------------------------------
create or replace function public.bos_set_module_access(p_user uuid, p_sections text[])
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_count   int;
  v_unknown text;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_user = auth.uid() then
    raise exception 'CANNOT_EDIT_OWN_ACCESS';
  end if;

  select string_agg(s, ', ') into v_unknown
    from unnest(coalesce(p_sections, array[]::text[])) s
   where not exists (select 1 from public.products where key = s);
  if v_unknown is not null then
    raise exception 'UNKNOWN_PRODUCT: %', v_unknown;
  end if;

  delete from public.employee_module_access
   where user_id = p_user
     and (p_sections is null or section <> all(p_sections));

  insert into public.employee_module_access (user_id, section, granted_by)
  select p_user, s, auth.uid()
    from unnest(coalesce(p_sections, array[]::text[])) s
  on conflict (user_id, section) do nothing;

  select count(*) into v_count
    from public.employee_module_access where user_id = p_user;
  return v_count;
end $fn$;

revoke all on function public.bos_my_sections() from public;
revoke all on function public.bos_can_access(text) from public;
revoke all on function public.bos_set_module_access(uuid, text[]) from public;
grant execute on function public.bos_my_sections() to authenticated;
grant execute on function public.bos_can_access(text) to authenticated;
grant execute on function public.bos_set_module_access(uuid, text[]) to authenticated;
