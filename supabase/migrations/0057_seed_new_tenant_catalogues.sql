-- ============================================================
-- 0057 -- A new business starts with the catalogues it needs.
--
-- Found by seeding a real business and watching it fail. bos_create_tenant
-- copied tenant_products and nothing else, so a business created through the
-- console had:
--
--   workstreams       0   -- goals have nothing to hang off, roadmap is empty
--   email_templates   0   -- the host CRM offers no templates
--   badges            0
--   community_gates   0
--
-- Those four were seeded by migrations 0007 and 0027 directly into whichever
-- tenant existed at the time, which was the default one. Every business
-- created since has been missing them, silently: nothing errors, the pages
-- just render empty and look like a product that does not work.
--
-- The default tenant's rows are the canonical seed, so they are the template.
-- Copying rather than re-listing them means the seed cannot drift from what
-- the first business actually has.
--
-- Idempotent. Safe to run twice, and safe to run against a business that
-- already has some of them.
-- ============================================================

-- ------------------------------------------------------------
-- First, a defect the seeding exposed.
--
-- community_gates has PRIMARY KEY (action), which is not scoped to a tenant.
-- So only ONE business on the whole platform can ever define a gate for a
-- given action: the second one to try gets a primary key violation. The table
-- carries tenant_id and a restrictive isolation policy, and its key quietly
-- makes the isolation impossible to use.
--
-- 0036 swept twenty-one narrow UNIQUE constraints into tenant-scoped ones and
-- did not touch this, because it is a PRIMARY KEY rather than a unique
-- constraint. Nothing references it -- no foreign key points at
-- community_gates, and meets_gate looks rows up by action AND tenant -- so
-- widening it is safe.
-- ------------------------------------------------------------
do $mig$
begin
  if exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.community_gates'::regclass
       and c.contype = 'p'
       and (select count(*) from unnest(c.conkey)) = 1)
  then
    alter table public.community_gates drop constraint community_gates_pkey;
    alter table public.community_gates add primary key (tenant_id, action);
  end if;
end $mig$;

create or replace function public.bos_seed_tenant_catalogues(p_tenant uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_from uuid;
  v_ws int := 0; v_et int := 0; v_bd int := 0; v_cg int := 0;
begin
  if not public.bos_is_super_admin()
     and public.bos_tenant_role(p_tenant) is distinct from 'admin'::public.user_role then
    raise exception 'FORBIDDEN';
  end if;

  -- The template is the default tenant: its rows are what the migrations
  -- seeded, so copying keeps the two from drifting apart.
  select id into v_from from public.tenants where is_default;
  if v_from is null or v_from = p_tenant then
    return jsonb_build_object('skipped', 'no template tenant');
  end if;

  insert into public.workstreams (tenant_id, key, name, color, sort_order)
  select p_tenant, w.key, w.name, w.color, w.sort_order
    from public.workstreams w
   where w.tenant_id = v_from
     and not exists (select 1 from public.workstreams x
                      where x.tenant_id = p_tenant and x.key = w.key);
  get diagnostics v_ws = row_count;

  insert into public.email_templates (tenant_id, key, name, purpose, subject, body, stage, sort_order)
  select p_tenant, e.key, e.name, e.purpose, e.subject, e.body, e.stage, e.sort_order
    from public.email_templates e
   where e.tenant_id = v_from
     and not exists (select 1 from public.email_templates x
                      where x.tenant_id = p_tenant and x.key = e.key);
  get diagnostics v_et = row_count;

  -- badges keys on slug, not key, and carries criteria. Read from the schema
  -- rather than assumed: the first version of this guessed and failed.
  insert into public.badges (tenant_id, slug, name, description, icon, criteria, threshold)
  select p_tenant, b.slug, b.name, b.description, b.icon, b.criteria, b.threshold
    from public.badges b
   where b.tenant_id = v_from
     and not exists (select 1 from public.badges x
                      where x.tenant_id = p_tenant and x.slug = b.slug);
  get diagnostics v_bd = row_count;

  -- community_gates is keyed on the action it gates, and carries a balance and
  -- a cost rather than a tier.
  insert into public.community_gates (tenant_id, action, label, min_balance, cost)
  select p_tenant, g.action, g.label, g.min_balance, g.cost
    from public.community_gates g
   where g.tenant_id = v_from
     and not exists (select 1 from public.community_gates x
                      where x.tenant_id = p_tenant and x.action = g.action);
  get diagnostics v_cg = row_count;

  return jsonb_build_object('workstreams', v_ws, 'email_templates', v_et,
                            'badges', v_bd, 'community_gates', v_cg);
end $fn$;

comment on function public.bos_seed_tenant_catalogues(uuid) is
  $c$Give a business the catalogues the migrations only ever seeded into the default tenant: workstreams, email templates, badges and community gates. Copies from the default tenant rather than re-listing the rows, so the seed cannot drift from what the first business actually has. Skips anything already present, so it is safe on a business that has some.$c$;

revoke all on function public.bos_seed_tenant_catalogues(uuid) from public, anon;
grant execute on function public.bos_seed_tenant_catalogues(uuid) to authenticated;

-- ------------------------------------------------------------
-- Creating a business now does it automatically.
-- ------------------------------------------------------------
create or replace function public.bos_create_tenant(
  p_name        text,
  p_slug        text default null,
  p_profile     jsonb default '{}'::jsonb,
  p_products    text[] default null,
  p_admin_email text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_name   text := trim(coalesce(p_name, ''));
  v_slug   text;
  v_tenant uuid;
  v_p      jsonb := coalesce(p_profile, '{}'::jsonb);
  v_email  text := lower(trim(coalesce(p_admin_email, '')));
  v_user   uuid;
  v_token  uuid;
  v_admin  text := null;
  v_bad    text;
  v_seed   jsonb;
begin
  perform public.bos_platform_owner_check();

  if length(v_name) < 2 then raise exception 'BAD_NAME'; end if;

  v_slug := public.bos_slugify(coalesce(nullif(trim(coalesce(p_slug, '')), ''), v_name));
  if v_slug is null then raise exception 'BAD_SLUG'; end if;
  if exists (select 1 from public.tenants where slug = v_slug) then
    raise exception 'SLUG_TAKEN: %', v_slug;
  end if;

  if p_products is not null then
    select string_agg(x, ', ') into v_bad
      from unnest(p_products) x
     where not exists (select 1 from public.products where key = x);
    if v_bad is not null then raise exception 'UNKNOWN_PRODUCT: %', v_bad; end if;
  end if;

  if v_email <> '' and position('@' in v_email) = 0 then raise exception 'BAD_EMAIL'; end if;

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
    case when (v_p->>'employee_count') ~ '^[0-9]+$' then (v_p->>'employee_count')::int end,
    case when (v_p->>'started_on') ~ '^\d{4}-\d{2}-\d{2}$' then (v_p->>'started_on')::date end,
    nullif(trim(coalesce(v_p->>'notes', '')), ''))
  returning id into v_tenant;

  insert into public.tenant_products (tenant_id, product_key, is_enabled)
  select v_tenant, p.key,
         case when p_products is null then p.is_enabled
              else p.is_enabled and p.key = any(p_products) end
    from public.products p
  on conflict (tenant_id, product_key) do nothing;

  -- The catalogues the migrations only ever gave the first business. Without
  -- this a new business opens with an empty roadmap and no email templates,
  -- which reads as a broken product rather than an empty one.
  v_seed := public.bos_seed_tenant_catalogues(v_tenant);

  if v_email <> '' then
    select id into v_user from public.users where lower(email) = v_email;
    if v_user is not null then
      insert into public.tenant_members (tenant_id, user_id, role, status, invited_by)
      values (v_tenant, v_user, 'admin', 'active', auth.uid())
      on conflict (tenant_id, user_id) do update set role = 'admin', status = 'active';
      v_admin := 'appointed';
    else
      insert into public.tenant_invitations (tenant_id, email, role, sections, invited_by)
      values (v_tenant, v_email, 'admin', array[]::text[], auth.uid())
      returning token into v_token;
      v_admin := 'invited';
    end if;
  else
    insert into public.tenant_members (tenant_id, user_id, role, status, invited_by)
    values (v_tenant, auth.uid(), 'admin', 'active', auth.uid())
    on conflict (tenant_id, user_id) do update set role = 'admin', status = 'active';
    v_admin := 'creator';
  end if;

  insert into public.audit_log (user_id, action, entity, entity_id, before, after, tenant_id)
  values (auth.uid(), 'create', 'tenants', v_tenant, null,
          jsonb_build_object('name', v_name, 'slug', v_slug, 'admin', v_admin,
                             'products', coalesce(array_length(p_products, 1), -1),
                             'seeded', v_seed),
          v_tenant);

  return jsonb_build_object(
    'tenant_id', v_tenant, 'slug', v_slug, 'admin', v_admin,
    'token', v_token, 'seeded', v_seed);
end $fn$;

revoke all on function public.bos_create_tenant(text, text, jsonb, text[], text) from public, anon;
grant execute on function public.bos_create_tenant(text, text, jsonb, text[], text) to authenticated;

-- ------------------------------------------------------------
-- Backfill: every business that already exists and missed out.
-- ------------------------------------------------------------
do $mig$
declare
  v_from uuid;
  r record;
begin
  select id into v_from from public.tenants where is_default;
  if v_from is null then return; end if;

  for r in select id from public.tenants where id <> v_from loop
    insert into public.workstreams (tenant_id, key, name, color, sort_order)
    select r.id, w.key, w.name, w.color, w.sort_order from public.workstreams w
     where w.tenant_id = v_from
       and not exists (select 1 from public.workstreams x where x.tenant_id = r.id and x.key = w.key);

    insert into public.email_templates (tenant_id, key, name, purpose, subject, body, stage, sort_order)
    select r.id, e.key, e.name, e.purpose, e.subject, e.body, e.stage, e.sort_order from public.email_templates e
     where e.tenant_id = v_from
       and not exists (select 1 from public.email_templates x where x.tenant_id = r.id and x.key = e.key);

    insert into public.badges (tenant_id, slug, name, description, icon, criteria, threshold)
    select r.id, b.slug, b.name, b.description, b.icon, b.criteria, b.threshold from public.badges b
     where b.tenant_id = v_from
       and not exists (select 1 from public.badges x where x.tenant_id = r.id and x.slug = b.slug);

    insert into public.community_gates (tenant_id, action, label, min_balance, cost)
    select r.id, g.action, g.label, g.min_balance, g.cost from public.community_gates g
     where g.tenant_id = v_from
       and not exists (select 1 from public.community_gates x where x.tenant_id = r.id and x.action = g.action);
  end loop;
end $mig$;
