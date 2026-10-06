-- ============================================================
-- Tenant isolation.
--
-- Stage 4 of the BOS Product Model plan. One RESTRICTIVE policy on each of
-- the 87 tenant-owned tables, so no row can be read or written outside the
-- tenant the request belongs to.
--
-- With one tenant this changes nothing: every row already belongs to it and
-- bos_request_tenant() resolves to it for every caller. That is what makes a
-- stage this wide safe to deploy.
--
-- ------------------------------------------------------------
-- RESTRICTIVE, and why an ordinary policy would have done the opposite
--
-- Postgres combines permissive policies with OR. Adding an ordinary policy
-- saying "or the row is in your tenant" would WIDEN access -- it would hand
-- every employee every row in the tenant, straight past the existing
-- per-user rules. A restrictive policy is AND-ed with the permissive ones
-- instead, which is the shape this needs: the existing policies keep deciding
-- WHETHER you may see a row, and this one adds AND IT MUST BE YOURS.
--
-- ------------------------------------------------------------
-- Scoped to authenticated and anon, deliberately
--
-- service_role is left out. The daily cron job, the payment webhook and
-- employee onboarding write as the service role on behalf of the platform
-- rather than on behalf of one tenant, and naming the two PostgREST roles
-- explicitly means those paths are unaffected whether or not service_role
-- carries BYPASSRLS.
--
-- ------------------------------------------------------------
-- FORCE ROW LEVEL SECURITY is NOT here, and the plan said it would be
--
-- The architecture document put it in this stage. Measured rather than
-- assumed, it cannot be: with FORCE on, a SECURITY DEFINER function owned by
-- a non-superuser owner stops seeing rows the permissive policies hide from
-- the CALLER, and the owner own writes start failing. All 76 definer
-- functions exist precisely because they bypass RLS -- notify() writes a
-- notification FOR ANOTHER USER, which the permissive policy
-- "auth.uid() = user_id" forbids -- so turning FORCE on would break the
-- notification system, every role check, and the door scanner.
--
-- It belongs after Stage 5, and only once it is known whether the owning role
-- carries BYPASSRLS, because FORCE removes the OWNERSHIP exemption and not
-- the role-attribute one. If the owner has BYPASSRLS, FORCE achieves nothing
-- at all and the owner hole stays open regardless; closing it is then
-- entirely Stage 5 work, inside each function body.
--
-- ------------------------------------------------------------
-- What this does NOT solve
--
-- An anonymous visitor resolves to the default tenant, so the public website
-- can only ever serve that one business. Serving a second tenant public site
-- needs the request to carry which tenant it is for -- a custom domain or a
-- host header -- which the architecture document lists as a known omission.
--
-- Idempotent. Run AFTER 0035. 0036 is independent of this.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Which tenant is this request about
--
-- bos_current_tenant answers for a signed-in member. This adds the fallbacks
-- a policy needs, because a restrictive policy comparing tenant_id against
-- NULL hides every row from everybody: an anonymous visitor on the public
-- site has no membership, and neither does a migration or a trigger running
-- outside a request.
--
-- The last branch is a deliberate guard. The default flag is load-bearing
-- once this policy exists, and clearing it would otherwise take the whole
-- product dark; with exactly one tenant there is no ambiguity to resolve.
-- ------------------------------------------------------------
create or replace function public.bos_request_tenant()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare v uuid;
begin
  v := public.bos_current_tenant();
  if v is not null then return v; end if;

  select id into v from public.tenants where is_default;
  if v is not null then return v; end if;

  if (select count(*) from public.tenants where status = 'active') = 1 then
    select id into v from public.tenants where status = 'active';
  end if;
  return v;
end $fn$;

comment on function public.bos_request_tenant() is
  $c$The tenant this request belongs to: the caller current tenant, else the default tenant, else the only tenant if there is exactly one. Every Stage 4 isolation policy compares against this.$c$;

-- One source of truth: the column default on 87 tables now delegates here
-- rather than repeating the same coalesce.
create or replace function public.bos_tenant_default()
returns uuid
language sql
stable
security definer
set search_path = public
as $fn$
  select public.bos_request_tenant();
$fn$;

comment on function public.bos_tenant_default() is
  $c$The tenant a new row belongs to. A thin wrapper over bos_request_tenant, kept because it is the column default on every tenant-owned table.$c$;

revoke all on function public.bos_request_tenant() from public;
grant execute on function public.bos_request_tenant() to authenticated, anon, service_role;

-- ------------------------------------------------------------
-- 2. The isolation policy, on every tenant-owned table
--
-- The tenancy tables themselves are left out on purpose. tenant_members
-- especially: reading your memberships ACROSS tenants is how the product
-- knows which tenants you can switch to, so a policy restricting it to one
-- tenant would make switching impossible. Their own policies are already
-- membership-scoped, which is the correct check for them.
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
  t text;
begin
  foreach t in array v_tables loop
    execute format('drop policy if exists "tenant isolation" on public.%I', t);
    execute format(
      'create policy "tenant isolation" on public.%I as restrictive
         for all to authenticated, anon
         using (tenant_id = public.bos_request_tenant())
         with check (tenant_id = public.bos_request_tenant())', t);
  end loop;
end $mig$;
