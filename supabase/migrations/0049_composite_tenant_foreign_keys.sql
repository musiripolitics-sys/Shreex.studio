-- ============================================================
-- A child row could point at another business parent row.
--
-- Found by testing rather than reading: an admin of one business could insert
-- a registration in THEIR tenant whose event_id named an event in somebody
-- else. The foreign key checked that the event existed; nothing checked it
-- belonged to the same business.
--
-- It is not a leak on its own -- the isolation policies from 0037 still stop
-- that admin reading the event itself -- but it is the shape a leak grows
-- from. Every one of the 66 foreign keys between two tenant-owned tables had
-- it, so the first query somebody writes that joins on event_id without also
-- matching tenant_id turns an inconsistent row into visible data.
--
-- The fix makes it impossible rather than unlikely: each of those foreign keys
-- becomes composite, (tenant_id, <column>) referencing (tenant_id, id). A
-- cross-tenant reference now fails at the constraint.
--
-- ------------------------------------------------------------
-- Two details that are not obvious
--
-- ON DELETE SET NULL on a composite key sets EVERY column of the key to null,
-- including tenant_id -- which is NOT NULL, so deleting the parent would fail.
-- The column is named explicitly instead, which Postgres 15 and later allow,
-- so only the reference is cleared.
--
-- And each of the 26 parent tables needs a unique index on (tenant_id, id)
-- for the composite key to have something to reference. It duplicates the
-- primary key, which is the price of the guarantee.
--
-- ------------------------------------------------------------
-- Now is the cheapest moment this will ever be done. Every row in the
-- database belongs to one tenant, so every constraint validates on the first
-- try. With two tenants and real data, any row that had drifted would have to
-- be found and fixed first.
--
-- Idempotent. Run AFTER 0048.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Something for the composite keys to reference
-- ------------------------------------------------------------
create unique index if not exists app_modules_tenant_id_id_key on public.app_modules (tenant_id, id);
create unique index if not exists assets_tenant_id_id_key on public.assets (tenant_id, id);
create unique index if not exists badges_tenant_id_id_key on public.badges (tenant_id, id);
create unique index if not exists benefits_tenant_id_id_key on public.benefits (tenant_id, id);
create unique index if not exists campaigns_tenant_id_id_key on public.campaigns (tenant_id, id);
create unique index if not exists communities_tenant_id_id_key on public.communities (tenant_id, id);
create unique index if not exists community_files_tenant_id_id_key on public.community_files (tenant_id, id);
create unique index if not exists events_tenant_id_id_key on public.events (tenant_id, id);
create unique index if not exists goals_tenant_id_id_key on public.goals (tenant_id, id);
create unique index if not exists host_submissions_tenant_id_id_key on public.host_submissions (tenant_id, id);
create unique index if not exists inventory_tenant_id_id_key on public.inventory (tenant_id, id);
create unique index if not exists kpis_tenant_id_id_key on public.kpis (tenant_id, id);
create unique index if not exists membership_plans_tenant_id_id_key on public.membership_plans (tenant_id, id);
create unique index if not exists orders_tenant_id_id_key on public.orders (tenant_id, id);
create unique index if not exists partners_tenant_id_id_key on public.partners (tenant_id, id);
create unique index if not exists payments_tenant_id_id_key on public.payments (tenant_id, id);
create unique index if not exists post_comments_tenant_id_id_key on public.post_comments (tenant_id, id);
create unique index if not exists posts_tenant_id_id_key on public.posts (tenant_id, id);
create unique index if not exists sop_documents_tenant_id_id_key on public.sop_documents (tenant_id, id);
create unique index if not exists sop_runs_tenant_id_id_key on public.sop_runs (tenant_id, id);
create unique index if not exists sop_steps_tenant_id_id_key on public.sop_steps (tenant_id, id);
create unique index if not exists sop_versions_tenant_id_id_key on public.sop_versions (tenant_id, id);
create unique index if not exists speakers_tenant_id_id_key on public.speakers (tenant_id, id);
create unique index if not exists tasks_tenant_id_id_key on public.tasks (tenant_id, id);
create unique index if not exists ticket_types_tenant_id_id_key on public.ticket_types (tenant_id, id);
create unique index if not exists workstreams_tenant_id_id_key on public.workstreams (tenant_id, id);

-- ------------------------------------------------------------
-- 2. 66 foreign keys, rebuilt with the tenant in the key
-- ------------------------------------------------------------
do $mig$
declare
  r record;
  v_new text;
begin
  for r in
    select * from (values
    ('app_modules_dependency_id_fkey', 'app_modules', 'dependency_id', 'app_modules', 'on delete set null (dependency_id)'),
    ('asset_versions_asset_id_fkey', 'asset_versions', 'asset_id', 'assets', 'on delete cascade'),
    ('assets_workstream_id_fkey', 'assets', 'workstream_id', 'workstreams', 'on delete set null (workstream_id)'),
    ('budgets_workstream_id_fkey', 'budgets', 'workstream_id', 'workstreams', 'on delete set null (workstream_id)'),
    ('campaigns_workstream_id_fkey', 'campaigns', 'workstream_id', 'workstreams', 'on delete set null (workstream_id)'),
    ('community_files_event_id_fkey', 'community_files', 'event_id', 'events', 'on delete cascade'),
    ('community_members_community_id_fkey', 'community_members', 'community_id', 'communities', 'on delete cascade'),
    ('complaints_event_id_fkey', 'complaints', 'event_id', 'events', 'on delete set null (event_id)'),
    ('content_items_campaign_id_fkey', 'content_items', 'campaign_id', 'campaigns', 'on delete set null (campaign_id)'),
    ('event_agenda_event_id_fkey', 'event_agenda', 'event_id', 'events', 'on delete cascade'),
    ('event_ops_event_id_fkey', 'event_ops', 'event_id', 'events', 'on delete cascade'),
    ('event_ops_marketing_campaign_id_fkey', 'event_ops', 'marketing_campaign_id', 'campaigns', 'on delete set null (marketing_campaign_id)'),
    ('event_questions_event_id_fkey', 'event_questions', 'event_id', 'events', 'on delete cascade'),
    ('event_speakers_event_id_fkey', 'event_speakers', 'event_id', 'events', 'on delete cascade'),
    ('event_speakers_speaker_id_fkey', 'event_speakers', 'speaker_id', 'speakers', 'on delete cascade'),
    ('events_community_id_fkey', 'events', 'community_id', 'communities', 'on delete set null (community_id)'),
    ('expenses_workstream_id_fkey', 'expenses', 'workstream_id', 'workstreams', 'on delete set null (workstream_id)'),
    ('file_unlocks_file_id_fkey', 'file_unlocks', 'file_id', 'community_files', 'on delete cascade'),
    ('goals_dependency_id_fkey', 'goals', 'dependency_id', 'goals', 'on delete set null (dependency_id)'),
    ('goals_workstream_id_fkey', 'goals', 'workstream_id', 'workstreams', 'on delete set null (workstream_id)'),
    ('host_messages_submission_id_fkey', 'host_messages', 'submission_id', 'host_submissions', 'on delete cascade'),
    ('host_submissions_event_id_fkey', 'host_submissions', 'event_id', 'events', 'on delete set null (event_id)'),
    ('host_submissions_published_event_id_fkey', 'host_submissions', 'published_event_id', 'events', 'on delete set null (published_event_id)'),
    ('inventory_custody_inventory_id_fkey', 'inventory_custody', 'inventory_id', 'inventory', 'on delete cascade'),
    ('kpi_values_kpi_id_fkey', 'kpi_values', 'kpi_id', 'kpis', 'on delete cascade'),
    ('leads_campaign_id_fkey', 'leads', 'campaign_id', 'campaigns', 'on delete set null (campaign_id)'),
    ('memberships_plan_id_fkey', 'memberships', 'plan_id', 'membership_plans', 'on delete set null (plan_id)'),
    ('orders_event_id_fkey', 'orders', 'event_id', 'events', 'on delete cascade'),
    ('orders_payment_id_fkey', 'orders', 'payment_id', 'payments', 'on delete set null (payment_id)'),
    ('orders_ticket_type_id_fkey', 'orders', 'ticket_type_id', 'ticket_types', 'on delete set null (ticket_type_id)'),
    ('partnerships_partner_id_fkey', 'partnerships', 'partner_id', 'partners', 'on delete set null (partner_id)'),
    ('plan_benefits_benefit_id_fkey', 'plan_benefits', 'benefit_id', 'benefits', 'on delete cascade'),
    ('plan_benefits_plan_id_fkey', 'plan_benefits', 'plan_id', 'membership_plans', 'on delete cascade'),
    ('point_events_event_id_fkey', 'point_events', 'event_id', 'events', 'on delete set null (event_id)'),
    ('post_comments_parent_id_fkey', 'post_comments', 'parent_id', 'post_comments', 'on delete cascade'),
    ('post_comments_post_id_fkey', 'post_comments', 'post_id', 'posts', 'on delete cascade'),
    ('post_reactions_post_id_fkey', 'post_reactions', 'post_id', 'posts', 'on delete cascade'),
    ('post_reports_comment_id_fkey', 'post_reports', 'comment_id', 'post_comments', 'on delete cascade'),
    ('post_reports_post_id_fkey', 'post_reports', 'post_id', 'posts', 'on delete cascade'),
    ('posts_community_id_fkey', 'posts', 'community_id', 'communities', 'on delete cascade'),
    ('posts_event_id_fkey', 'posts', 'event_id', 'events', 'on delete cascade'),
    ('registrations_event_id_fkey', 'registrations', 'event_id', 'events', 'on delete cascade'),
    ('registrations_order_id_fkey', 'registrations', 'order_id', 'orders', 'on delete set null (order_id)'),
    ('registrations_payment_id_fkey', 'registrations', 'payment_id', 'payments', 'on delete set null (payment_id)'),
    ('registrations_ticket_type_id_fkey', 'registrations', 'ticket_type_id', 'ticket_types', 'on delete set null (ticket_type_id)'),
    ('revenue_entries_related_event_id_fkey', 'revenue_entries', 'related_event_id', 'events', 'on delete set null (related_event_id)'),
    ('revenue_entries_workstream_id_fkey', 'revenue_entries', 'workstream_id', 'workstreams', 'on delete set null (workstream_id)'),
    ('saved_events_event_id_fkey', 'saved_events', 'event_id', 'events', 'on delete cascade'),
    ('sop_acknowledgements_version_id_fkey', 'sop_acknowledgements', 'version_id', 'sop_versions', 'on delete cascade'),
    ('sop_run_items_run_id_fkey', 'sop_run_items', 'run_id', 'sop_runs', 'on delete cascade'),
    ('sop_run_items_step_id_fkey', 'sop_run_items', 'step_id', 'sop_steps', 'on delete cascade'),
    ('sop_runs_event_id_fkey', 'sop_runs', 'event_id', 'events', 'on delete set null (event_id)'),
    ('sop_runs_sop_id_fkey', 'sop_runs', 'sop_id', 'sop_documents', 'on delete cascade'),
    ('sop_runs_version_id_fkey', 'sop_runs', 'version_id', 'sop_versions', 'on delete cascade'),
    ('sop_steps_version_id_fkey', 'sop_steps', 'version_id', 'sop_versions', 'on delete cascade'),
    ('sop_versions_sop_id_fkey', 'sop_versions', 'sop_id', 'sop_documents', 'on delete cascade'),
    ('sponsorships_event_id_fkey', 'sponsorships', 'event_id', 'events', 'on delete set null (event_id)'),
    ('sponsorships_partner_id_fkey', 'sponsorships', 'partner_id', 'partners', 'on delete cascade'),
    ('sponsorships_payment_id_fkey', 'sponsorships', 'payment_id', 'payments', 'on delete set null (payment_id)'),
    ('task_comments_task_id_fkey', 'task_comments', 'task_id', 'tasks', 'on delete cascade'),
    ('task_reviews_task_id_fkey', 'task_reviews', 'task_id', 'tasks', 'on delete cascade'),
    ('tasks_dependency_id_fkey', 'tasks', 'dependency_id', 'tasks', 'on delete set null (dependency_id)'),
    ('tasks_goal_id_fkey', 'tasks', 'goal_id', 'goals', 'on delete set null (goal_id)'),
    ('tasks_workstream_id_fkey', 'tasks', 'workstream_id', 'workstreams', 'on delete set null (workstream_id)'),
    ('ticket_types_event_id_fkey', 'ticket_types', 'event_id', 'events', 'on delete cascade'),
    ('user_badges_badge_id_fkey', 'user_badges', 'badge_id', 'badges', 'on delete cascade')
    ) as t(conname, child, childcol, parent, ondelete)
  loop
    v_new := r.child || '_tenant_' || r.childcol || '_fkey';
    if length(v_new) > 63 then
      v_new := left(v_new, 63);
    end if;

    -- Already rebuilt? Leave it.
    if exists (select 1 from pg_constraint
                where conname = v_new
                  and conrelid = format('public.%I', r.child)::regclass) then
      continue;
    end if;

    execute format('alter table public.%I drop constraint if exists %I', r.child, r.conname);
    execute format(
      'alter table public.%I add constraint %I
         foreign key (tenant_id, %I) references public.%I (tenant_id, id) %s',
      r.child, v_new, r.childcol, r.parent, r.ondelete);
  end loop;
end $mig$;
