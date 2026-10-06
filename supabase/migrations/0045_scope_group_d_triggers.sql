-- ============================================================
-- Stage 5, last batch: the eleven Group D triggers.
--
-- These turned out lighter than the architecture document assumed, and for a
-- reason worth recording: the column defaults added in 0035 already put every
-- trigger-written row in the right tenant. What the triggers needed was
-- scoping on what they READ -- a count, a lookup, a duplicate check -- and, in
-- three cases, writing the tenant EXPLICITLY rather than inheriting it from
-- the request.
--
-- That last distinction is the subtle one. A trigger fires in whatever session
-- caused the write. For a tenant admin editing their own row the request
-- tenant and the row tenant agree. For the daily cron or the payment webhook,
-- writing as the service role, bos_request_tenant resolves to the DEFAULT
-- tenant -- so a notification about a second business task would have been
-- filed against the first. Where the row knows its own tenant, these take it
-- from the row.
--
-- Four of the eleven need no predicate at all, and are commented rather than
-- rewritten so the inventory can record that they were considered:
--
--   sync_user_email, handle_new_user       public.users is global by design
--   bos_guard_contact_rate                 scoped through bos_rate_limit,
--   bos_guard_newsletter_rate              whose key carries the tenant since 0044
--
-- Idempotent. Run AFTER 0044.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The change log
--
-- govern_changes rows that inherited the request tenant instead of the row
-- tenant would have been invisible to the business whose record changed --
-- the history would simply have a hole in it.
-- ------------------------------------------------------------
create or replace function public.bos_track_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_before jsonb := to_jsonb(old);
  v_after  jsonb := to_jsonb(new);
  k text;
  a text;
  b text;
begin
  for k in select jsonb_object_keys(v_after) loop
    -- Bookkeeping columns are not news.
    if k in ('id', 'created_at', 'updated_at') then continue; end if;
    b := v_before ->> k;
    a := v_after  ->> k;
    if b is distinct from a then
      insert into public.govern_changes (entity, entity_id, field, before, after, changed_by, tenant_id)
      values (tg_table_name, new.id, k, b, a, auth.uid(), new.tenant_id);
    end if;
  end loop;
  return new;
end $fn$;

-- ------------------------------------------------------------
-- 2. The task approval chain
-- ------------------------------------------------------------
create or replace function public.bos_guard_task_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_admin boolean := public.is_admin();
begin
  -- Nobody but an admin may hand themselves an approval. Everyone else may
  -- only put a task up for one, and only from a state that has not been
  -- decided yet.
  if new.approval_state is distinct from old.approval_state and not v_admin then
    if new.approval_state <> 'pending' then
      raise exception 'Only an admin can approve or reject a task.'
        using errcode = 'check_violation';
    end if;
    if old.approval_state not in ('none', 'rejected') then
      raise exception 'This task has already been submitted.'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.approval_state = 'pending' and old.approval_state is distinct from 'pending' then
    if new.owner_id is null then
      raise exception 'Assign this task to someone before submitting it.'
        using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.task_comments c
                    where c.task_id = new.id and c.tenant_id = new.tenant_id) then
      raise exception 'Leave a comment saying what was done before submitting it.'
        using errcode = 'check_violation';
    end if;
    new.submitted_at := now();
    new.submitted_by := auth.uid();
  end if;

  if new.status = 'completed' and old.status is distinct from 'completed' then
    if new.owner_id is null then
      raise exception 'Assign this task to someone before completing it.'
        using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.task_comments c
                    where c.task_id = new.id and c.tenant_id = new.tenant_id) then
      raise exception 'Leave a comment saying what was done before completing it.'
        using errcode = 'check_violation';
    end if;

    if v_admin then
      -- The admin closing it is the approval. No request to file.
      if new.approval_state <> 'approved' then
        new.approval_state := 'approved';
        new.decided_at     := now();
        new.decided_by     := auth.uid();
      end if;
    elsif new.approval_state <> 'approved' then
      raise exception 'An admin has to approve this before it can be completed.'
        using errcode = 'check_violation';
    end if;
  end if;

  -- A rejection sends the work back; it cannot stay completed.
  if new.approval_state = 'rejected' and new.status = 'completed' then
    new.status := 'in_progress';
  end if;

  if new.approval_state in ('approved', 'rejected')
     and old.approval_state is distinct from new.approval_state then
    new.decided_at := now();
    new.decided_by := auth.uid();
  end if;

  return new;
end $fn$;

create or replace function public.bos_sync_task_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.approval_state = 'pending' and old.approval_state is distinct from 'pending' then
    delete from public.approvals
     where related_type = 'task' and related_id = new.id and decision = 'pending'
       and tenant_id = new.tenant_id;
    insert into public.approvals (request_type, request_title, requester_id, decision,
                                  related_type, related_id, tenant_id)
    values ('Task', coalesce(new.code || ' ', '') || new.title, new.submitted_by, 'pending',
            'task', new.id, new.tenant_id);

  elsif new.approval_state in ('approved', 'rejected')
        and old.approval_state is distinct from new.approval_state then
    update public.approvals
       set decision   = new.approval_state::text::approval_decision,
           approver_id = new.decided_by,
           decided_at = now(),
           comments   = new.decision_note
     where related_type = 'task' and related_id = new.id and decision = 'pending'
       and tenant_id = new.tenant_id;
  end if;
  return new;
end $fn$;

create or replace function public.bos_open_task_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.status = 'completed' and coalesce(old.status, 'not_started') <> 'completed' then
    insert into public.task_reviews (task_id, estimate_hours, actual_hours, tenant_id)
    values (new.id, new.estimate_hours, new.actual_hours, new.tenant_id)
    on conflict (task_id) do update
      set estimate_hours = coalesce(public.task_reviews.estimate_hours, excluded.estimate_hours);
  end if;
  return new;
end $fn$;

-- ------------------------------------------------------------
-- 3. The two notifications written from a trigger
--
-- The insert is inlined rather than calling notify, because notify takes its
-- tenant from bos_request_tenant -- the tenant of whoever caused the write.
-- For the cron or the webhook that is the default tenant, so a notification
-- about another business task would have been filed in the wrong one. From a
-- trigger the row knows better than the request does.
-- ------------------------------------------------------------
create or replace function public.bos_notify_task_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_owner uuid;
  v_label text;
  v_body  text;
begin
  -- Only when it lands on a real outcome, and only when that is a change.
  if new.outcome = 'pending' or new.outcome is not distinct from old.outcome then
    return new;
  end if;

  select t.owner_id, coalesce(t.code || ' ', '') || t.title
    into v_owner, v_label
    from public.tasks t
   where t.id = new.task_id and t.tenant_id = new.tenant_id;

  if v_owner is null or v_owner = auth.uid() then
    return new;
  end if;

  v_body := case new.outcome
              when 'met'     then 'Reviewed as met.'
              when 'partial' then 'Reviewed as partially met.'
              when 'missed'  then 'Reviewed as missed.'
              else 'An outcome was recorded.'
            end;

  if new.quality is not null then
    v_body := v_body || ' Quality ' || new.quality || ' of 5.';
  end if;
  if nullif(trim(coalesce(new.learning, '')), '') is not null then
    v_body := v_body || ' Learning: ' || new.learning;
  end if;

  insert into public.notifications (user_id, type, title, body, link, tenant_id)
  values (v_owner, 'review', 'Your work was reviewed: ' || v_label, v_body,
          '/admin/os/reviews?tab=tasks', new.tenant_id);
  return new;
end $fn$;

create or replace function public.bos_notify_task_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_label text;
begin
  if new.approval_state is not distinct from old.approval_state then
    return new;
  end if;
  if new.approval_state not in ('approved', 'rejected') then
    return new;
  end if;
  if new.owner_id is null or new.owner_id = auth.uid() then
    return new;
  end if;

  v_label := coalesce(new.code || ' ', '') || new.title;

  if new.approval_state = 'approved' then
    insert into public.notifications (user_id, type, title, body, link, tenant_id)
    values (new.owner_id, 'task', 'Approved: ' || v_label,
            'Your work was approved and the task is now complete.', '/admin/os/tasks',
            new.tenant_id);
  else
    insert into public.notifications (user_id, type, title, body, link, tenant_id)
    values (new.owner_id, 'task', 'Sent back: ' || v_label,
            coalesce(nullif(trim(coalesce(new.decision_note, '')), ''), 'This needs another look.'),
            '/admin/os/tasks', new.tenant_id);
  end if;
  return new;
end $fn$;

-- ------------------------------------------------------------
-- 4. The denormalised count
--
-- It counted every active member of a community across every business. With
-- one tenant that is the same number; with two it is somebody else members
-- added to yours.
-- ------------------------------------------------------------
create or replace function public.sync_community_member_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_community uuid := coalesce(new.community_id, old.community_id);
  v_tenant    uuid := coalesce(new.tenant_id, old.tenant_id);
begin
  update public.communities c
     set member_count = (
       select count(*) from public.community_members m
        where m.community_id = v_community
          and m.state = 'active'
          and m.tenant_id = v_tenant)
   where c.id = v_community and c.tenant_id = v_tenant;
  return null;
end $fn$;

-- ------------------------------------------------------------
-- 5. The four that need nothing, recorded rather than rewritten
-- ------------------------------------------------------------
comment on function public.sync_user_email() is
  $c$Mirrors the auth email onto public.users, which is global by design: one person, one account, across every tenant. No tenant predicate applies.$c$;

comment on function public.handle_new_user() is
  $c$Creates the public.users row, which is global, and claims guest registrations made with the same address. That claim is deliberately cross-tenant: the account belongs to the person, so a registration they made at any business is theirs. Joining them to a tenant is bos_seed_tenant_membership, separately.$c$;

comment on function public.bos_guard_contact_rate() is
  $c$Scoped through bos_rate_limit, whose key carries the tenant since 0044. Both the per-address limit and the hourly ceiling are therefore per business, so one business being spammed cannot exhaust another allowance.$c$;

comment on function public.bos_guard_newsletter_rate() is
  $c$As bos_guard_contact_rate: scoped through the rate limit key rather than by a predicate here.$c$;
