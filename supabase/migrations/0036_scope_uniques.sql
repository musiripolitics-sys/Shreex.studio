-- ============================================================
-- Drop the 21 unique constraints that would collide across tenants.
--
-- The last part of Stage 3. Migration 0035 added a composite beside each of
-- these; this removes the narrow one, which is what currently stops two
-- businesses from sharing a task code, an event slug, a Gold tier or a
-- January.
--
-- ------------------------------------------------------------
-- RUN THIS AFTER the application code that moved to the composite
-- on_conflict targets has deployed.
--
-- PostgREST matches an on_conflict= target against a real unique index. Four
-- upserts named the narrow columns:
--
--   cashflow_months   month,scenario          -> tenant_id,month,scenario
--   reviews           period_type,period_start-> tenant_id,period_type,period_start
--   employee_profiles user_id                 -> tenant_id,user_id   (two call sites)
--
-- Running this before that code deploys makes those four fail with 42P10,
-- "no unique or exclusion constraint matching the ON CONFLICT
-- specification". Running it after is safe, because 0035 created the
-- composite targets the new code names and this only removes the old ones.
--
-- bos_set_module_access has the same dependency and is updated here rather
-- than in the application, so the function and the constraint change
-- together in one transaction.
--
-- Idempotent. Run AFTER 0035, and after the deploy.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The function that inserts on one of these
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

  -- tenant_id is not named: it comes from the column default, which is what
  -- keeps this function free of tenancy until Stage 5 scopes it properly.
  insert into public.employee_module_access (user_id, section, granted_by)
  select p_user, s, auth.uid()
    from unnest(coalesce(p_sections, array[]::text[])) s
  on conflict (tenant_id, user_id, section) do nothing;

  select count(*) into v_count
    from public.employee_module_access where user_id = p_user;
  return v_count;
end $fn$;

revoke all on function public.bos_set_module_access(uuid, text[]) from public;
grant execute on function public.bos_set_module_access(uuid, text[]) to authenticated;

-- ------------------------------------------------------------
-- 2. The narrow constraints
-- ------------------------------------------------------------
-- badges(slug) is an index, not a constraint, despite the name.
drop index if exists public.badges_slug_key;
alter table public.campaigns drop constraint if exists campaigns_code_key;
alter table public.cashflow_months drop constraint if exists cashflow_months_month_scenario_key;
alter table public.cities drop constraint if exists cities_name_key;
alter table public.communities drop constraint if exists communities_slug_key;
alter table public.complaints drop constraint if exists complaints_ref_key;
alter table public.data_fields drop constraint if exists data_fields_table_name_column_name_key;
alter table public.email_templates drop constraint if exists email_templates_key_key;
alter table public.employee_module_access drop constraint if exists employee_module_access_user_id_section_key;
alter table public.employee_profiles drop constraint if exists employee_profiles_user_id_key;
alter table public.events drop constraint if exists events_slug_key;
alter table public.goals drop constraint if exists goals_code_key;
alter table public.kpi_values drop constraint if exists kpi_values_kpi_id_period_key;
alter table public.membership_plans drop constraint if exists membership_plans_tier_key;
alter table public.newsletter_subscribers drop constraint if exists newsletter_subscribers_email_key;
alter table public.promo_codes drop constraint if exists promo_codes_code_key;
alter table public.reviews drop constraint if exists reviews_period_type_period_start_key;
alter table public.risks drop constraint if exists risks_code_key;
alter table public.sop_documents drop constraint if exists sop_documents_code_key;
alter table public.tasks drop constraint if exists tasks_code_key;
alter table public.workstreams drop constraint if exists workstreams_key_key;
