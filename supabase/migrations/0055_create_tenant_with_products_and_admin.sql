-- ============================================================
-- 0055 -- Creating a business asks what it needs and who runs it.
--
-- Two things were decided silently at create time, and both were wrong.
--
-- 1. Every new business got all nine products. The catalogue is what the
--    platform sells, not what a business bought, and a nine-item sidebar for a
--    business that uses two is the clutter the whole dense rebuild is against.
--
-- 2. The creator became its administrator. For a platform owner setting up a
--    business for somebody else that is exactly backwards -- it is how the
--    super admin ended up administering Techxfluence, which is a tenant like
--    any other and should have its own. The creator is now the FALLBACK, used
--    only when nobody else is named, because a business with no admin cannot
--    appoint one itself.
--
-- The return type changes from uuid to jsonb, because "created, and here is
-- the invitation link for its administrator" cannot be said in a uuid.
--
-- Idempotent. Safe to run twice.
-- ============================================================

drop function if exists public.bos_create_tenant(text, text, jsonb);
drop function if exists public.bos_create_tenant(text, text);

create or replace function public.bos_create_tenant(
  p_name        text,
  p_slug        text default null,
  p_profile     jsonb default '{}'::jsonb,
  -- null means every product, which keeps older callers working.
  -- An empty array means none, and is a different instruction.
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
begin
  perform public.bos_platform_owner_check();

  if length(v_name) < 2 then raise exception 'BAD_NAME'; end if;

  v_slug := public.bos_slugify(coalesce(nullif(trim(coalesce(p_slug, '')), ''), v_name));
  if v_slug is null then raise exception 'BAD_SLUG'; end if;
  if exists (select 1 from public.tenants where slug = v_slug) then
    raise exception 'SLUG_TAKEN: %', v_slug;
  end if;

  -- Validate the product list before writing anything, so a typo does not
  -- leave a business created with the wrong sidebar.
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

  -- Every product gets a row either way. Writing the off ones explicitly is
  -- what stops a product enabled platform-wide later from appearing in a
  -- business that never asked for it.
  insert into public.tenant_products (tenant_id, product_key, is_enabled)
  select v_tenant, p.key,
         case when p_products is null then p.is_enabled
              else p.is_enabled and p.key = any(p_products) end
    from public.products p
  on conflict (tenant_id, product_key) do nothing;

  -- Who runs it.
  if v_email <> '' then
    select id into v_user from public.users where lower(email) = v_email;
    if v_user is not null then
      insert into public.tenant_members (tenant_id, user_id, role, status, invited_by)
      values (v_tenant, v_user, 'admin', 'active', auth.uid())
      on conflict (tenant_id, user_id) do update set role = 'admin', status = 'active';
      v_admin := 'appointed';
    else
      -- No account yet, which is the normal case when a business is being set
      -- up FOR somebody. An invitation is not a lesser outcome here.
      insert into public.tenant_invitations (tenant_id, email, role, sections, invited_by)
      values (v_tenant, v_email, 'admin', array[]::text[], auth.uid())
      returning token into v_token;
      v_admin := 'invited';
    end if;
  else
    -- Nobody named: the creator holds it so the business is not unreachable.
    insert into public.tenant_members (tenant_id, user_id, role, status, invited_by)
    values (v_tenant, auth.uid(), 'admin', 'active', auth.uid())
    on conflict (tenant_id, user_id) do update set role = 'admin', status = 'active';
    v_admin := 'creator';
  end if;

  insert into public.audit_log (user_id, action, entity, entity_id, before, after, tenant_id)
  values (auth.uid(), 'create', 'tenants', v_tenant, null,
          jsonb_build_object('name', v_name, 'slug', v_slug, 'admin', v_admin,
                             'products', coalesce(array_length(p_products, 1), -1)),
          v_tenant);

  return jsonb_build_object(
    'tenant_id', v_tenant,
    'slug', v_slug,
    'admin', v_admin,
    'token', v_token);
end $fn$;

comment on function public.bos_create_tenant(text, text, jsonb, text[], text) is
  $c$Create a business with the products it needs and the administrator who runs it. p_products null means every enabled product and an empty array means none -- different instructions. The creator becomes admin only when no administrator is named, because a business with none cannot appoint one itself; naming one is what stops the platform owner quietly administering every tenant. Returns jsonb rather than a uuid because "created, and here is the invitation link" does not fit in a uuid.$c$;

revoke all on function public.bos_create_tenant(text, text, jsonb, text[], text) from public, anon;
grant execute on function public.bos_create_tenant(text, text, jsonb, text[], text) to authenticated;
