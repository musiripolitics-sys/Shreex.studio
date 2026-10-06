-- ============================================================
-- tenant_id on every tenant-owned table.
--
-- Stage 3 of the BOS Product Model plan, and the largest mechanical step in
-- it: 87 tables gain a column, a backfill, a default, a not-null, a
-- foreign key and an index. No policy changes. Nothing reads the column for
-- an access decision yet -- that is Stage 4.
--
-- ------------------------------------------------------------
-- Why there is a DEFAULT, and why the migration would break the site
-- without one
--
-- Every insert in the application would violate the not-null the moment this
-- ran. There are hundreds of insert paths across 87 tables and none of
-- them passes a tenant. So the column defaults to bos_tenant_default(),
-- which is the caller current tenant when there is one and the default
-- tenant otherwise -- the second case matters because the cron job, the
-- payment webhook and employee onboarding all write as the service role,
-- which has no auth.uid() and therefore no membership.
--
-- ------------------------------------------------------------
-- Why the foreign key is ON DELETE RESTRICT
--
-- CASCADE would mean one delete from tenants silently removes every row this
-- business owns across 87 tables. Tenant-level deletion is not designed yet
-- (it is listed as a known omission in the architecture document), and until
-- it is, refusing the delete is the only safe answer.
--
-- ------------------------------------------------------------
-- Why the old unique constraints are still here
--
-- This migration ADDS a composite unique constraint beside each of the 21
-- that would collide across tenants; it does not drop the narrow one. The
-- narrow constraint is what PostgREST matches an on_conflict= target
-- against, and four upserts in the application name those columns. Dropping
-- them here would break those upserts between this migration running and the
-- new code deploying -- and the new code cannot name the composite target
-- before this migration creates it, so no ordering of the two is safe.
--
-- So: run this, deploy the code that moves to the composite targets, then run
-- 0036, which drops the narrow ones. Each step is safe on its own, and while
-- only one tenant exists the narrow constraint is simply the stricter of two
-- rules that agree.
--
-- Idempotent. Run AFTER 0034.
-- ============================================================

-- ------------------------------------------------------------
-- 1. What tenant does a new row belong to
-- ------------------------------------------------------------
create or replace function public.bos_tenant_default()
returns uuid
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(
    public.bos_current_tenant(),
    (select id from public.tenants where is_default)
  );
$fn$;

comment on function public.bos_tenant_default() is
  $c$The tenant a new row belongs to: the caller current tenant, or the default tenant when there is no caller. Used as the column default on every tenant-owned table so existing insert paths keep working unchanged. Definer because it reads tenants, which has RLS, and a service-role insert has no membership to read it with.$c$;

revoke all on function public.bos_tenant_default() from public;
grant execute on function public.bos_tenant_default() to authenticated, anon, service_role;

-- ------------------------------------------------------------
-- 2. The column, on every tenant-owned table
--
-- The list is explicit rather than derived, because deriving it would also
-- catch the identity, platform and tenancy tables, which must NOT have a
-- tenant_id. supabase/tests/tenancy-stage3.test.mjs asserts this array is
-- exactly the tenant bucket of supabase/tenancy/tables.json, so the two
-- cannot drift.
-- ------------------------------------------------------------
do $mig$
declare
  v_tables text[] := array[
    'activities',
    'ambassadors',
    'app_modules',
    'approvals',
    'asset_versions',
    'assets',
    'audit_log',
    'badges',
    'benefits',
    'budgets',
    'campaigns',
    'cashflow_months',
    'cities',
    'communities',
    'community_files',
    'community_gates',
    'community_members',
    'competitors',
    'complaints',
    'contact_messages',
    'content_items',
    'data_fields',
    'dependencies',
    'email_templates',
    'employee_kpis',
    'employee_module_access',
    'employee_profiles',
    'event_agenda',
    'event_ops',
    'event_questions',
    'event_speakers',
    'events',
    'expenses',
    'feedback',
    'file_unlocks',
    'goals',
    'govern_changes',
    'hiring_plan',
    'host_messages',
    'host_submissions',
    'influencers',
    'inventory',
    'inventory_custody',
    'kpi_values',
    'kpis',
    'leader_profiles',
    'leads',
    'legal_items',
    'membership_plans',
    'memberships',
    'newsletter_subscribers',
    'notifications',
    'orders',
    'organizer_follows',
    'partners',
    'partnerships',
    'payments',
    'payouts',
    'plan_benefits',
    'podcast_episodes',
    'point_events',
    'post_comments',
    'post_reactions',
    'post_reports',
    'posts',
    'promo_codes',
    'registrations',
    'revenue_entries',
    'reviews',
    'risks',
    'saved_events',
    'sop_acknowledgements',
    'sop_documents',
    'sop_run_items',
    'sop_runs',
    'sop_steps',
    'sop_versions',
    'sops',
    'speakers',
    'sponsorships',
    'task_comments',
    'task_reviews',
    'tasks',
    'ticket_types',
    'user_badges',
    'vendors',
    'workstreams'
  ];
  t        text;
  v_tenant uuid;
begin
  select id into v_tenant from public.tenants where is_default;
  if v_tenant is null then
    raise exception 'NO_DEFAULT_TENANT: run 0034_tenants.sql first';
  end if;

  foreach t in array v_tables loop
    -- Nullable first. Adding a nullable column with no default is a catalogue
    -- change in Postgres 11 and later, so it does not rewrite the table.
    execute format('alter table public.%I add column if not exists tenant_id uuid', t);

    -- Backfill. Every row that exists belongs to tenant #1 by definition:
    -- there has only ever been one business in this database.
    execute format('update public.%I set tenant_id = %L where tenant_id is null', t, v_tenant);

    -- Then the default, so inserts from here on carry a tenant without the
    -- application knowing the column exists.
    execute format(
      'alter table public.%I alter column tenant_id set default public.bos_tenant_default()', t);

    execute format('alter table public.%I alter column tenant_id set not null', t);

    -- Index, for the sake of the foreign key check on tenant deletion and
    -- for the policies Stage 4 adds. It earns nothing while one tenant exists
    -- -- every row has the same value, so the planner will ignore it -- but it
    -- is cheap and it is the shape the next stage needs.
    execute format(
      'create index if not exists %I on public.%I (tenant_id)', t || '_tenant_idx', t);

    if not exists (select 1 from pg_constraint
                    where conname = t || '_tenant_id_fkey'
                      and conrelid = format('public.%I', t)::regclass) then
      execute format(
        'alter table public.%I add constraint %I foreign key (tenant_id)
           references public.tenants(id) on delete restrict',
        t, t || '_tenant_id_fkey');
    end if;
  end loop;
end $mig$;

-- ------------------------------------------------------------
-- 3. A composite unique beside each of the 21 that would collide
--
-- Each of these currently forbids two businesses from sharing a task code, an
-- event slug, a Gold tier, a January, or the letter R and the number 01.
-- ------------------------------------------------------------
-- badges(slug) is a unique INDEX, so it is matched by an index rather than a constraint.
create unique index if not exists badges_tenant_slug_key
  on public.badges (tenant_id, slug);

do $mig$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'campaigns_tenant_code_key'
                    and conrelid = 'public.campaigns'::regclass) then
    alter table public.campaigns
      add constraint campaigns_tenant_code_key unique (tenant_id, code);
  end if;
end $mig$;

do $mig$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'cashflow_months_tenant_month_scenario_key'
                    and conrelid = 'public.cashflow_months'::regclass) then
    alter table public.cashflow_months
      add constraint cashflow_months_tenant_month_scenario_key unique (tenant_id, month, scenario);
  end if;
end $mig$;

do $mig$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'cities_tenant_name_key'
                    and conrelid = 'public.cities'::regclass) then
    alter table public.cities
      add constraint cities_tenant_name_key unique (tenant_id, name);
  end if;
end $mig$;

do $mig$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'communities_tenant_slug_key'
                    and conrelid = 'public.communities'::regclass) then
    alter table public.communities
      add constraint communities_tenant_slug_key unique (tenant_id, slug);
  end if;
end $mig$;

do $mig$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'complaints_tenant_ref_key'
                    and conrelid = 'public.complaints'::regclass) then
    alter table public.complaints
      add constraint complaints_tenant_ref_key unique (tenant_id, ref);
  end if;
end $mig$;

do $mig$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'data_fields_tenant_table_name_column_name_key'
                    and conrelid = 'public.data_fields'::regclass) then
    alter table public.data_fields
      add constraint data_fields_tenant_table_name_column_name_key unique (tenant_id, table_name, column_name);
  end if;
end $mig$;

do $mig$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'email_templates_tenant_key_key'
                    and conrelid = 'public.email_templates'::regclass) then
    alter table public.email_templates
      add constraint email_templates_tenant_key_key unique (tenant_id, key);
  end if;
end $mig$;

do $mig$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'employee_module_access_tenant_user_id_section_key'
                    and conrelid = 'public.employee_module_access'::regclass) then
    alter table public.employee_module_access
      add constraint employee_module_access_tenant_user_id_section_key unique (tenant_id, user_id, section);
  end if;
end $mig$;

do $mig$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'employee_profiles_tenant_user_id_key'
                    and conrelid = 'public.employee_profiles'::regclass) then
    alter table public.employee_profiles
      add constraint employee_profiles_tenant_user_id_key unique (tenant_id, user_id);
  end if;
end $mig$;

do $mig$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'events_tenant_slug_key'
                    and conrelid = 'public.events'::regclass) then
    alter table public.events
      add constraint events_tenant_slug_key unique (tenant_id, slug);
  end if;
end $mig$;

do $mig$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'goals_tenant_code_key'
                    and conrelid = 'public.goals'::regclass) then
    alter table public.goals
      add constraint goals_tenant_code_key unique (tenant_id, code);
  end if;
end $mig$;

do $mig$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'kpi_values_tenant_kpi_id_period_key'
                    and conrelid = 'public.kpi_values'::regclass) then
    alter table public.kpi_values
      add constraint kpi_values_tenant_kpi_id_period_key unique (tenant_id, kpi_id, period);
  end if;
end $mig$;

do $mig$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'membership_plans_tenant_tier_key'
                    and conrelid = 'public.membership_plans'::regclass) then
    alter table public.membership_plans
      add constraint membership_plans_tenant_tier_key unique (tenant_id, tier);
  end if;
end $mig$;

do $mig$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'newsletter_subscribers_tenant_email_key'
                    and conrelid = 'public.newsletter_subscribers'::regclass) then
    alter table public.newsletter_subscribers
      add constraint newsletter_subscribers_tenant_email_key unique (tenant_id, email);
  end if;
end $mig$;

do $mig$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'promo_codes_tenant_code_key'
                    and conrelid = 'public.promo_codes'::regclass) then
    alter table public.promo_codes
      add constraint promo_codes_tenant_code_key unique (tenant_id, code);
  end if;
end $mig$;

do $mig$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'reviews_tenant_period_type_period_start_key'
                    and conrelid = 'public.reviews'::regclass) then
    alter table public.reviews
      add constraint reviews_tenant_period_type_period_start_key unique (tenant_id, period_type, period_start);
  end if;
end $mig$;

do $mig$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'risks_tenant_code_key'
                    and conrelid = 'public.risks'::regclass) then
    alter table public.risks
      add constraint risks_tenant_code_key unique (tenant_id, code);
  end if;
end $mig$;

do $mig$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'sop_documents_tenant_code_key'
                    and conrelid = 'public.sop_documents'::regclass) then
    alter table public.sop_documents
      add constraint sop_documents_tenant_code_key unique (tenant_id, code);
  end if;
end $mig$;

do $mig$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'tasks_tenant_code_key'
                    and conrelid = 'public.tasks'::regclass) then
    alter table public.tasks
      add constraint tasks_tenant_code_key unique (tenant_id, code);
  end if;
end $mig$;

do $mig$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'workstreams_tenant_key_key'
                    and conrelid = 'public.workstreams'::regclass) then
    alter table public.workstreams
      add constraint workstreams_tenant_key_key unique (tenant_id, key);
  end if;
end $mig$;
