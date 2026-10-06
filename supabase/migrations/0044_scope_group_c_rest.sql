-- ============================================================
-- Stage 5, sixth batch: the last nine Group C mutators.
--
-- Three of them needed a decision rather than a predicate, and all three are
-- the same shape: a function that looks up "the admins" and finds the
-- PLATFORM admins rather than the ones who run the business the row belongs
-- to. Under tenancy that is both a leak and a nuisance -- one business
-- reports a post and every other business admin gets the notification.
--
-- Idempotent. Run AFTER 0043.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Credits and files
-- ------------------------------------------------------------

-- The function the Stage 4 suite has been using as its demonstration: it
-- handed over another business gated file, and spent the caller credits
-- doing it.
create or replace function public.unlock_file(p_file_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_file   public.community_files;
  v_bal    int;
  v_tenant uuid := public.bos_request_tenant();
begin
  if v_uid is null then
    return jsonb_build_object('status', 'denied', 'message', 'Sign in to download this.');
  end if;

  select * into v_file from public.community_files
   where id = p_file_id and tenant_id = v_tenant;
  if not found then
    return jsonb_build_object('status', 'denied', 'message', 'File not found.');
  end if;

  -- Same visibility rule as posts: a session group's files are for attendees.
  if v_file.event_id is not null
     and not (public.is_admin() or public.attended(v_file.event_id)) then
    return jsonb_build_object('status', 'denied',
      'message', 'This file is for people who attended the session.');
  end if;

  -- Already paid, or free, or admin — hand it over.
  if public.is_admin()
     or v_file.credit_cost = 0
     or exists (select 1 from public.file_unlocks
                 where file_id = p_file_id and user_id = v_uid
                   and tenant_id = v_tenant) then
    insert into public.file_unlocks (file_id, user_id, spent, tenant_id)
    values (p_file_id, v_uid, 0, v_tenant)
    on conflict (file_id, user_id) do nothing;
    return jsonb_build_object('status', 'ok', 'path', v_file.storage_path);
  end if;

  select points into v_bal from public.users where id = v_uid;
  if coalesce(v_bal, 0) < v_file.credit_cost then
    return jsonb_build_object('status', 'short',
      'needed', v_file.credit_cost, 'balance', coalesce(v_bal, 0),
      'message', format('This download costs %s credits — you have %s. Attend a session to earn 10 more.',
                        v_file.credit_cost, coalesce(v_bal, 0)));
  end if;

  perform public.spend_credits(
    v_file.credit_cost, 'Downloaded ' || v_file.title, v_file.event_id);

  insert into public.file_unlocks (file_id, user_id, spent, tenant_id)
  values (p_file_id, v_uid, v_file.credit_cost, v_tenant)
  on conflict (file_id, user_id) do nothing;

  return jsonb_build_object('status', 'ok', 'path', v_file.storage_path);
end $fn$;

-- Filtered to the caller already, so it leaked nothing. The ledger row is
-- what needed the tenant: users.points stays global, which is a data-model
-- question for later, but a business should be able to see what was spent in
-- it without seeing what was spent elsewhere.
create or replace function public.spend_credits(p_amount integer, p_reason text, p_event_id uuid default null::uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_new int;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Invalid amount'; end if;
  if p_amount = 0 then
    return (select points from public.users where id = v_uid);
  end if;

  update public.users
     set points = points - p_amount
   where id = v_uid and points >= p_amount
   returning points into v_new;

  if not found then
    raise exception 'Not enough credits' using errcode = 'check_violation';
  end if;

  insert into public.point_events (user_id, delta, reason, event_id, tenant_id)
  values (v_uid, -p_amount, p_reason, p_event_id, public.bos_request_tenant());

  return v_new;
end $fn$;

-- ------------------------------------------------------------
-- 2. Communities
-- ------------------------------------------------------------
create or replace function public.join_community(p_community uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_c      public.communities;
  v_tenant uuid := public.bos_request_tenant();
begin
  if v_uid is null then
    return jsonb_build_object('status','denied','message','Sign in to join.');
  end if;

  select * into v_c from public.communities
   where id = p_community and tenant_id = v_tenant;
  if not found or v_c.status <> 'published' then
    return jsonb_build_object('status','denied','message','Chapter not found.');
  end if;

  insert into public.community_members (community_id, user_id, role, state, tenant_id)
  values (p_community, v_uid, 'member',
          (case when v_c.join_policy = 'approval' then 'pending' else 'active' end)::membership_state,
          v_tenant)
  on conflict (community_id, user_id) do nothing;

  if v_c.join_policy = 'approval' then
    return jsonb_build_object('status','pending',
      'message','Request sent — an organiser will review it.');
  end if;

  if v_c.welcome_message is not null then
    perform public.notify(v_uid, 'community',
      'Welcome to ' || v_c.name, v_c.welcome_message, '/c/' || v_c.slug);
  end if;

  return jsonb_build_object('status','joined','message','You''re in.');
end $fn$;

-- ------------------------------------------------------------
-- 3. The three that looked up the wrong admins
--
-- Each read public.user_roles for role = 'admin', which is the PLATFORM admin
-- list. The notification should go to whoever runs the business the row
-- belongs to, which is now tenant_members.
-- ------------------------------------------------------------
create or replace function public.report_content(p_post_id uuid, p_comment_id uuid, p_reason text default null::text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_admin  record;
  v_body   text;
  v_tenant uuid := public.bos_request_tenant();
begin
  if v_uid is null then
    return jsonb_build_object('status', 'denied', 'message', 'Sign in to report this.');
  end if;
  if num_nonnulls(p_post_id, p_comment_id) <> 1 then
    return jsonb_build_object('status', 'denied', 'message', 'Nothing to report.');
  end if;

  -- The thing being reported has to be in this business.
  if p_post_id is not null and not exists (
       select 1 from public.posts where id = p_post_id and tenant_id = v_tenant)
  then
    return jsonb_build_object('status', 'denied', 'message', 'Nothing to report.');
  end if;
  if p_comment_id is not null and not exists (
       select 1 from public.post_comments where id = p_comment_id and tenant_id = v_tenant)
  then
    return jsonb_build_object('status', 'denied', 'message', 'Nothing to report.');
  end if;

  insert into public.post_reports (post_id, comment_id, reporter_id, reason, tenant_id)
  values (p_post_id, p_comment_id, v_uid, nullif(trim(coalesce(p_reason, '')), ''), v_tenant)
  on conflict do nothing;

  if not found then
    -- Already reported by this person; don't notify admins twice.
    return jsonb_build_object('status', 'ok', 'message', 'You already reported this.');
  end if;

  v_body := coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'No reason given.');

  for v_admin in
    select m.user_id from public.tenant_members m
     where m.tenant_id = v_tenant and m.role = 'admin' and m.status = 'active'
  loop
    perform public.notify(v_admin.user_id, 'report', 'Content reported',
      v_body, '/admin?tab=reports');
  end loop;

  return jsonb_build_object('status', 'ok', 'message', 'Reported. Thanks — an admin will take a look.');
end $fn$;

create or replace function public.ensure_group_seed_post(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_event  public.events;
  v_author uuid;
  v_name   text;
  v_tenant uuid := public.bos_request_tenant();
begin
  if p_event_id is null then return; end if;
  if exists (select 1 from public.posts
              where event_id = p_event_id and tenant_id = v_tenant) then return; end if;

  select * into v_event from public.events
   where id = p_event_id and tenant_id = v_tenant;
  if not found then return; end if;

  v_author := v_event.host_id;
  if v_author is null then
    select m.user_id into v_author from public.tenant_members m
     where m.tenant_id = v_tenant and m.role = 'admin' and m.status = 'active'
     order by m.joined_at limit 1;
  end if;
  if v_author is null then return; end if;  -- nobody to attribute it to

  select coalesce(full_name, 'Techxfluence') into v_name from public.users where id = v_author;

  insert into public.posts (author_id, author_name, author_role, body, pinned, channel, event_id, tenant_id)
  values (
    v_author,
    coalesce(v_name, 'Techxfluence'),
    'Host',
    format(
      'Welcome to the %s group.' || chr(10) || chr(10) ||
      'This space is private to everyone who attended. Share your takeaways, '
      'post what you built, and ask the questions you didn''t get to on the day. '
      'Slides and recordings will show up under Downloads.',
      v_event.title),
    true,
    'event',
    p_event_id,
    v_tenant
  );
end $fn$;

create or replace function public.notify_followers(p_event_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ev     public.events;
  v_n      int := 0;
  f        record;
  v_tenant uuid := public.bos_request_tenant();
begin
  select * into v_ev from public.events
   where id = p_event_id and tenant_id = v_tenant;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  if not (public.is_admin() or v_ev.host_id = auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;
  if v_ev.status <> 'published' then return 0; end if;

  for f in
    select follower_id from public.organizer_follows
    where organizer_id = v_ev.host_id and tenant_id = v_tenant
  loop
    perform public.notify(
      f.follower_id, 'event',
      'New event from ' || coalesce(v_ev.host_name, 'an organizer you follow'),
      v_ev.title,
      '/events/' || v_ev.slug
    );
    v_n := v_n + 1;
  end loop;
  return v_n;
end $fn$;

-- ------------------------------------------------------------
-- 4. Approvals and the roadmap sync
-- ------------------------------------------------------------
create or replace function public.decide_approval(p_id uuid, p_decision text, p_comments text default null::text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_a public.approvals;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_decision not in ('approved','rejected','pending') then raise exception 'BAD_DECISION'; end if;

  update public.approvals
     set decision   = p_decision::approval_decision,
         decided_at  = case when p_decision = 'pending' then null else now() end,
         approver_id = auth.uid(),
         comments    = coalesce(nullif(trim(coalesce(p_comments, '')), ''), comments)
   where id = p_id
     and tenant_id = public.bos_request_tenant()
   returning * into v_a;
  if not found then raise exception 'NOT_FOUND'; end if;

  if v_a.requester_id is not null and p_decision in ('approved','rejected') then
    perform public.notify(
      v_a.requester_id, 'approval',
      'Your ' || v_a.request_type || ' request was ' || p_decision,
      v_a.request_title,
      '/admin/os/approvals'
    );
  end if;
end $fn$;

create or replace function public.bos_sync_roadmap_tasks()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_count  int;
  v_tenant uuid := public.bos_request_tenant();
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;

  with created as (
    insert into public.tasks
      (goal_id, workstream_id, title, description, owner_id,
       start_date, due_date, priority, status, tenant_id)
    select g.id,
           g.workstream_id,
           coalesce(nullif(trim(g.deliverable), ''), g.objective, 'Untitled goal'),
           case when nullif(trim(g.deliverable), '') is not null then g.objective end,
           g.owner_id,
           g.start_date,
           g.end_date,
           g.priority,
           g.status,
           v_tenant
      from public.goals g
     where g.tenant_id = v_tenant
       and not exists (select 1 from public.tasks t
                        where t.goal_id = g.id and t.tenant_id = v_tenant)
    returning id, goal_id
  )
  select count(*) into v_count from created;

  -- Mirror goal-to-goal dependencies onto the tasks they produced.
  update public.tasks t
     set dependency_id = dep.id
    from public.goals g
    join public.tasks dep on dep.goal_id = g.dependency_id and dep.tenant_id = v_tenant
   where t.goal_id = g.id
     and t.tenant_id = v_tenant
     and g.tenant_id = v_tenant
     and g.dependency_id is not null
     and t.dependency_id is null;

  return v_count;
end $fn$;

-- ------------------------------------------------------------
-- 5. Rate limiting, per business
--
-- rate_limits is a platform table with no tenant_id, and it stays that way:
-- the rows are counters, not records. What was wrong is that the KEY was not
-- scoped, so two businesses sharing an address shared an allowance -- and one
-- could exhaust the other by being spammed.
--
-- Existing counters are abandoned by the key change, which costs nothing: the
-- worst case is one caller getting a fresh allowance in the current window.
-- ------------------------------------------------------------
create or replace function public.bos_rate_limit(p_bucket text, p_key text, p_limit integer, p_window interval)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_start  timestamptz;
  v_count  int;
  v_tenant uuid := public.bos_request_tenant();
  v_key    text;
begin
  if p_key is null or length(trim(p_key)) = 0 then
    return true;      -- nothing to key on; the caller has other defences
  end if;

  v_key := coalesce(v_tenant::text, 'none') || ':' || lower(trim(p_key));

  -- Truncate now to the window, so every hit in the same window shares a row.
  v_start := to_timestamp(floor(extract(epoch from now()) / extract(epoch from p_window))
                          * extract(epoch from p_window));

  insert into public.rate_limits (bucket, key, window_start, count)
  values (p_bucket, v_key, v_start, 1)
  on conflict (bucket, key, window_start)
  do update set count = public.rate_limits.count + 1
  returning count into v_count;

  -- Opportunistic cleanup, cheap because it only fires on the first hit of a
  -- window and there is no scheduler here to do it properly.
  if v_count = 1 then
    delete from public.rate_limits where window_start < now() - interval '2 days';
  end if;

  return v_count <= p_limit;
end $fn$;
