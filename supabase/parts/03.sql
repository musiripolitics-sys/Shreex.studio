-- schema.sql part 3 of 6
-- Source lines 957-1737 of supabase/schema.sql.
-- Run the parts in order. Each is idempotent, like the whole file.

-- ---------- B6: record offline sponsorship revenue (admin) ----------
create or replace function public.record_sponsorship(p_amount int, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  insert into public.payments (user_id, stream, amount, currency, status, provider, provider_ref)
  values (auth.uid(), 'sponsorship', p_amount, 'INR', 'paid', 'manual', null);
end; $$;

-- ---------- A6: public top-members leaderboard (opt-in members only) ----------
create or replace function public.get_top_members(p_limit int default 10)
returns table (full_name text, city text, points int)
language sql security definer stable set search_path = public as $$
  select u.full_name, u.city, u.points
  from public.users u
  where u.discoverable = true and u.points > 0
  order by u.points desc
  limit least(coalesce(p_limit, 10), 50);
$$;

-- ---------- member discount, in SQL so pricing has one source of truth ----------
create or replace function public.member_discount_pct(p_user_id uuid)
returns int language sql security definer stable set search_path = public as $$
  select coalesce((
    select case when m.tier = 'Elite' then 50
                when m.tier = 'Pro'   then 25
                else 0 end
    from public.memberships m
    where m.user_id = p_user_id
      and m.status = 'active'
      and (m.renews_at is null or m.renews_at > now())
    limit 1
  ), 0);
$$;

-- create_pending_order gains an optional answers payload (appended last so
-- every existing caller keeps working unchanged).
create or replace function public.create_pending_order(
  p_event_id       uuid,
  p_ticket_type_id uuid,
  p_quantity       int,
  p_buyer_name     text,
  p_buyer_email    text,
  p_buyer_phone    text default null,
  p_promo_code     text default null,
  p_user_id        uuid default null,
  p_answers        jsonb default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_event public.events;
  v_tt    public.ticket_types;
  v_uid   uuid;
  v_subtotal int; v_member_pct int := 0; v_promo_pct int := 0; v_best_pct int;
  v_discount int; v_total int; v_order_id uuid;
begin
  v_uid := case when auth.role() = 'service_role'
                then coalesce(auth.uid(), p_user_id)
                else auth.uid() end;

  select * into v_event from public.events where id = p_event_id for update;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  if v_event.status <> 'published' then raise exception 'EVENT_NOT_OPEN'; end if;
  if coalesce(v_event.starts_at, v_event.date::timestamptz) < now() then
    raise exception 'EVENT_OVER';
  end if;

  select * into v_tt from public.ticket_types
   where id = p_ticket_type_id and event_id = p_event_id for update;
  if not found then raise exception 'TICKET_TYPE_NOT_FOUND'; end if;
  if v_tt.sales_start is not null and now() < v_tt.sales_start then raise exception 'SALES_NOT_STARTED'; end if;
  if v_tt.sales_end   is not null and now() > v_tt.sales_end   then raise exception 'SALES_ENDED'; end if;
  if p_quantity < greatest(v_tt.min_per_order, 1) then raise exception 'MIN_QTY'; end if;
  if p_quantity > v_tt.max_per_order then raise exception 'MAX_QTY'; end if;
  if v_tt.capacity - v_tt.sold < p_quantity then raise exception 'NOT_ENOUGH_SEATS'; end if;

  v_subtotal := v_tt.price_amount * p_quantity;

  if v_uid is not null then v_member_pct := public.member_discount_pct(v_uid); end if;
  if p_promo_code is not null and length(trim(p_promo_code)) > 0 then
    v_promo_pct := public.validate_promo(p_promo_code);
    if v_promo_pct <= 0 then raise exception 'INVALID_PROMO'; end if;
  end if;

  v_best_pct := greatest(v_member_pct, v_promo_pct);
  v_discount := round(v_subtotal * v_best_pct / 100.0);
  v_total    := v_subtotal - v_discount;

  insert into public.orders (
    user_id, event_id, ticket_type_id, quantity,
    buyer_name, buyer_email, buyer_phone,
    subtotal, discount, total, currency, promo_code, status, expires_at, answers
  ) values (
    v_uid, p_event_id, p_ticket_type_id, p_quantity,
    p_buyer_name, p_buyer_email, p_buyer_phone,
    v_subtotal, v_discount, v_total, v_tt.currency,
    nullif(trim(coalesce(p_promo_code, '')), ''),
    'pending', now() + interval '15 minutes', p_answers
  ) returning id into v_order_id;

  update public.ticket_types set sold = sold + p_quantity where id = p_ticket_type_id;
  update public.events set spots_left = greatest(spots_left - p_quantity, 0) where id = p_event_id;

  return jsonb_build_object(
    'order_id', v_order_id, 'subtotal', v_subtotal, 'discount', v_discount,
    'total', v_total, 'currency', v_tt.currency, 'discount_pct', v_best_pct
  );
end; $$;

-- ---------- fulfil_order: issue the tickets (idempotent) ----------
create or replace function public.fulfil_order(p_order_id uuid, p_payment_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_o public.orders; v_codes text[] := '{}'; v_code text; i int;
begin
  select * into v_o from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;

  if v_o.status = 'paid' then
    select coalesce(array_agg(ticket_code), '{}') into v_codes
      from public.registrations where order_id = p_order_id;
    return jsonb_build_object('ok', true, 'already', true, 'tickets', to_jsonb(v_codes));
  end if;
  if v_o.status <> 'pending' then raise exception 'ORDER_NOT_PENDING'; end if;

  for i in 1..v_o.quantity loop
    insert into public.registrations (
      event_id, user_id, ticket_type_id, order_id,
      attendee_name, attendee_email, attendee_phone, status, payment_id
    ) values (
      v_o.event_id, v_o.user_id, v_o.ticket_type_id, v_o.id,
      v_o.buyer_name, v_o.buyer_email, v_o.buyer_phone, 'registered', p_payment_id
    ) returning ticket_code into v_code;
    v_codes := array_append(v_codes, v_code);
  end loop;

  update public.orders
     set status = 'paid',
         payment_id = coalesce(p_payment_id, payment_id),
         expires_at = null
   where id = p_order_id;

  if v_o.promo_code is not null then perform public.redeem_promo(v_o.promo_code); end if;

  return jsonb_build_object('ok', true, 'tickets', to_jsonb(v_codes));
end; $$;

-- register_free_order passes answers straight through.
create or replace function public.register_free_order(
  p_event_id uuid, p_ticket_type_id uuid, p_quantity int,
  p_buyer_name text, p_buyer_email text, p_buyer_phone text default null,
  p_answers jsonb default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_tt public.ticket_types; v_order jsonb;
begin
  select * into v_tt from public.ticket_types
   where id = p_ticket_type_id and event_id = p_event_id;
  if not found then raise exception 'TICKET_TYPE_NOT_FOUND'; end if;
  if v_tt.price_amount > 0 then raise exception 'NOT_FREE'; end if;

  if exists (
    select 1 from public.registrations r
     where r.event_id = p_event_id
       and r.attendee_email = p_buyer_email
       and r.status in ('registered', 'attended')
  ) then raise exception 'ALREADY_REGISTERED'; end if;

  v_order := public.create_pending_order(
    p_event_id, p_ticket_type_id, p_quantity,
    p_buyer_name, p_buyer_email, p_buyer_phone, null, null, p_answers
  );
  return public.fulfil_order((v_order->>'order_id')::uuid, null);
end; $$;

-- ---------- expire_pending_orders: release abandoned checkouts ----------
create or replace function public.expire_pending_orders()
returns int language plpgsql security definer set search_path = public as $$
declare v_o record; v_n int := 0;
begin
  for v_o in
    select * from public.orders
     where status = 'pending' and expires_at is not null and expires_at < now()
     for update
  loop
    update public.ticket_types set sold = greatest(sold - v_o.quantity, 0)
      where id = v_o.ticket_type_id;
    update public.events set spots_left = spots_left + v_o.quantity
      where id = v_o.event_id;
    update public.orders set status = 'cancelled' where id = v_o.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end; $$;

-- ============================================================
-- Techxfluence — admin side of host payouts.
--   • get_all_host_earnings() — every host's gross/fee/net/paid/balance
--   • record_payout()         — log a settlement to a host
-- Run once. Idempotent.
-- ============================================================

create or replace function public.get_all_host_earnings()
returns table (
  host_id      uuid,
  host_name    text,
  host_email   text,
  gross        bigint,
  platform_fee bigint,
  net          bigint,
  paid_out     bigint,
  balance      bigint
)
language sql security definer stable set search_path = public as $$
  with gross as (
    select e.host_id, coalesce(sum(p.amount), 0)::bigint as amt
    from public.payments p
    join public.events e on e.id = p.related_id and p.related_type = 'events'
    where p.stream = 'ticket_sales' and p.status = 'paid' and e.host_id is not null
    group by e.host_id
  ),
  paid as (
    select host_id, coalesce(sum(amount), 0)::bigint as amt
    from public.payouts group by host_id
  )
  select u.id,
         u.full_name,
         u.email::text,
         coalesce(g.amt, 0),
         (coalesce(g.amt, 0) / 10),
         (coalesce(g.amt, 0) * 9 / 10),
         coalesce(pd.amt, 0),
         (coalesce(g.amt, 0) * 9 / 10) - coalesce(pd.amt, 0)
  from public.users u
  left join gross g on g.host_id = u.id
  left join paid  pd on pd.host_id = u.id
  where public.is_admin()
    and (g.amt is not null or pd.amt is not null)
  order by ((coalesce(g.amt, 0) * 9 / 10) - coalesce(pd.amt, 0)) desc;
$$;

create or replace function public.record_payout(
  p_host_id uuid, p_amount int, p_note text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;

  insert into public.payouts (host_id, amount, note, created_by)
  values (p_host_id, p_amount, p_note, auth.uid())
  returning id into v_id;

  perform public.notify(
    p_host_id, 'payout', 'Payout sent 💸',
    'A payout of ₹' || (p_amount / 100)::text || ' is on its way to you.',
    '/host/dashboard'
  );
  return v_id;
end; $$;

-- ============================================================
-- Techxfluence — per-event analytics for the organiser.
-- Host-or-admin gated: a host only ever sees their own events.
-- Run once. Idempotent.
-- ============================================================
create or replace function public.get_event_stats(p_event_id uuid)
returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare v_ev public.events;
begin
  select * into v_ev from public.events where id = p_event_id;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  if not (public.is_admin() or v_ev.host_id = auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;

  return jsonb_build_object(
    'revenue', (
      select coalesce(sum(p.amount), 0) from public.payments p
      where p.related_type = 'events' and p.related_id = p_event_id and p.status = 'paid'
    ),
    'tickets', (
      select count(*) from public.registrations r
      where r.event_id = p_event_id and r.status in ('registered', 'attended')
    ),
    'checked_in', (
      select count(*) from public.registrations r
      where r.event_id = p_event_id and r.status = 'attended'
    ),
    'waitlisted', (
      select count(*) from public.registrations r
      where r.event_id = p_event_id and r.status = 'waitlisted'
    ),
    'last7', (
      select count(*) from public.registrations r
      where r.event_id = p_event_id and r.registered_at > now() - interval '7 days'
    ),
    'tiers', (
      select coalesce(
        jsonb_agg(jsonb_build_object(
          'name', t.name, 'sold', t.sold, 'capacity', t.capacity, 'price', t.price_amount
        ) order by t.sort_order), '[]'::jsonb)
      from public.ticket_types t where t.event_id = p_event_id
    )
  );
end; $$;

-- ---------- Public organizer profile (safe fields only) ----------
create or replace function public.get_organizer(p_id uuid)
returns jsonb
language sql security definer stable set search_path = public as $$
  select case when u.id is null then null else jsonb_build_object(
    'id',          u.id,
    'name',        u.full_name,
    'city',        u.city,
    'bio',         u.bio,
    'linkedin',    u.linkedin_url,
    'events_count',(select count(*) from public.events e
                    where e.host_id = u.id and e.status = 'published'),
    'followers',   (select count(*) from public.organizer_follows f
                    where f.organizer_id = u.id)
  ) end
  from public.users u
  where u.id = p_id
    and u.primary_role in ('event_host', 'admin')
    -- Only someone actually running public events gets a public page.
    and exists (select 1 from public.events e
                where e.host_id = u.id and e.status = 'published');
$$;

-- ---------- Notify followers when an organizer publishes ----------
create or replace function public.notify_followers(p_event_id uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare v_ev public.events; v_n int := 0; f record;
begin
  select * into v_ev from public.events where id = p_event_id;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  if not (public.is_admin() or v_ev.host_id = auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;
  if v_ev.status <> 'published' then return 0; end if;

  for f in
    select follower_id from public.organizer_follows
    where organizer_id = v_ev.host_id
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
end; $$;


-- ============================================================
-- Triggers
-- ============================================================

drop trigger if exists trg_users_updated on public.users;
create trigger trg_users_updated before update on public.users
  for each row execute function set_updated_at();

drop trigger if exists trg_events_updated on public.events;
create trigger trg_events_updated before update on public.events
  for each row execute function set_updated_at();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists trg_sync_user_email on auth.users;
create trigger trg_sync_user_email
  after update of email on auth.users
  for each row execute function public.sync_user_email();


-- ============================================================
-- Community: credits, gates, threading and paid downloads
-- ============================================================
-- Credits are the points members already earn at check-in (+10). Speaking is
-- gated on the balance you *hold*; downloads are the one thing that spends it.
-- Every gate is a row in community_gates, so switching an action from a
-- threshold to a per-use charge is a config change, not a migration.

-- ---------- Gate configuration ----------
create table if not exists public.community_gates (
  action      text primary key,
  min_balance int not null default 0,
  cost        int not null default 0,
  label       text
);

insert into public.community_gates (action, min_balance, cost, label) values
  ('comment',     10, 0, 'Comment on a post'),
  ('post_group',  10, 0, 'Post in a session group'),
  ('post_global', 30, 0, 'Post in a public channel')
on conflict (action) do nothing;

-- ---------- Files a group can offer ----------
create table if not exists public.community_files (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid references public.events(id) on delete cascade,
  channel      text,
  title        text not null,
  description  text,
  storage_path text not null,
  mime_type    text,
  size_bytes   bigint,
  credit_cost  int  not null default 0,
  created_by   uuid not null references public.users(id) on delete cascade,
  created_at   timestamptz not null default now()
);
create index if not exists community_files_event_idx on public.community_files(event_id);

-- Who has already paid for what, so a file is only ever charged once.
create table if not exists public.file_unlocks (
  file_id    uuid not null references public.community_files(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  spent      int  not null default 0,
  created_at timestamptz not null default now(),
  primary key (file_id, user_id)
);

-- ---------- One level of comment threading ----------
alter table public.post_comments
  add column if not exists parent_id uuid references public.post_comments(id) on delete cascade;
create index if not exists post_comments_parent_idx on public.post_comments(parent_id);

-- ---------- Credit ledger + spend ----------
-- users.points stays the authoritative balance (the directory already reads
-- it); point_events is the history behind it. Both move together, always
-- inside one statement or one function.

-- Internal: award credits and log why. Not granted to clients.
create or replace function public.award_credits(
  p_user uuid, p_amount int, p_reason text, p_event_id uuid default null
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_user is null or p_amount = 0 then return; end if;
  update public.users set points = points + p_amount where id = p_user;
  insert into public.point_events (user_id, delta, reason, event_id)
  values (p_user, p_amount, p_reason, p_event_id);
end;
$$;

-- Spend the caller's credits. The check and the debit are one UPDATE, so two
-- concurrent calls can never both pass a balance that only covers one.
create or replace function public.spend_credits(
  p_amount int, p_reason text, p_event_id uuid default null
) returns int
language plpgsql security definer set search_path = public
as $$
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

  insert into public.point_events (user_id, delta, reason, event_id)
  values (v_uid, -p_amount, p_reason, p_event_id);

  return v_new;
end;
$$;

-- Does the caller clear the gate for this action? Admins always do.
create or replace function public.meets_gate(p_action text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_admin() or coalesce((
    select u.points >= g.min_balance
      from public.users u
      join public.community_gates g on g.action = p_action
     where u.id = auth.uid()
  ), true);
$$;

-- ---------- Buying a download ----------
-- Returns the storage path only once the file is unlocked. The caller still
-- has to mint a signed URL server-side; this function is the authority on
-- whether they may.
create or replace function public.unlock_file(p_file_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_file public.community_files;
  v_bal  int;
begin
  if v_uid is null then
    return jsonb_build_object('status', 'denied', 'message', 'Sign in to download this.');
  end if;

  select * into v_file from public.community_files where id = p_file_id;
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
                 where file_id = p_file_id and user_id = v_uid) then
    insert into public.file_unlocks (file_id, user_id, spent)
    values (p_file_id, v_uid, 0)
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

  insert into public.file_unlocks (file_id, user_id, spent)
  values (p_file_id, v_uid, v_file.credit_cost)
  on conflict (file_id, user_id) do nothing;

  return jsonb_build_object('status', 'ok', 'path', v_file.storage_path);
end;
$$;

-- ---------- Backfill the ledger ----------
-- Members already hold points awarded before point_events existed. Give each
-- an opening entry so their history reconciles with their balance. Skips
-- anyone who already has ledger rows, so re-running schema.sql is safe.
insert into public.point_events (user_id, delta, reason)
select u.id, u.points, 'Attendance credits earned before the ledger existed'
  from public.users u
 where u.points > 0
   and not exists (select 1 from public.point_events pe where pe.user_id = u.id);



-- ---------- Trust levels ----------
-- Badges are awarded from participation, Discourse-style: attendance and
-- posting, re-evaluated whenever a member is checked in. `slug` makes each
-- badge addressable so the seed below stays idempotent.
alter table public.badges add column if not exists slug text;
alter table public.badges add column if not exists threshold int;
-- Plain (not partial) so ON CONFLICT (slug) can infer it. Postgres still
-- permits multiple NULL slugs under a unique index.
create unique index if not exists badges_slug_key on public.badges(slug);

insert into public.badges (slug, name, description, icon, criteria, threshold) values
  ('first_session', 'First session',  'Attended your first Techxfluence event.', 'ticket',  'attendance', 1),
  ('regular',       'Regular',        'Attended five sessions.',                 'medal',   'attendance', 5),
  ('committed',     'Committed',      'Attended ten sessions.',                  'trophy',  'attendance', 10),
  ('contributor',   'Contributor',    'Posted in the community five times.',     'sparkle', 'posts',      5)
on conflict (slug) do update
  set name = excluded.name,
      description = excluded.description,
      icon = excluded.icon,
      criteria = excluded.criteria,
      threshold = excluded.threshold;

-- Re-evaluate one member's badges. Cheap, idempotent, safe to call often.
create or replace function public.refresh_badges(p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_sessions int;
  v_posts    int;
begin
  if p_user is null then return; end if;

  select count(*) into v_sessions from public.registrations
   where user_id = p_user and status = 'attended';
  select count(*) into v_posts from public.posts where author_id = p_user;

  insert into public.user_badges (user_id, badge_id)
  select p_user, b.id
    from public.badges b
   where b.threshold is not null
     and ((b.criteria = 'attendance' and v_sessions >= b.threshold)
       or (b.criteria = 'posts'      and v_posts    >= b.threshold))
  on conflict (user_id, badge_id) do nothing;
end;
$$;

revoke all on function public.refresh_badges(uuid) from public;
grant execute on function public.refresh_badges(uuid) to authenticated;

drop policy if exists "read badges" on public.badges;
create policy "read badges" on public.badges for select using (true);

drop policy if exists "read user badges" on public.user_badges;
create policy "read user badges" on public.user_badges for select using (true);

alter table public.badges enable row level security;
alter table public.user_badges enable row level security;



-- ---------- Reports ----------
-- Admins could already delete a post; nothing told them one needed deleting.
-- A report notifies every admin and keeps a row so the queue survives a
-- dismissed notification.
create table if not exists public.post_reports (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid references public.posts(id) on delete cascade,
  comment_id  uuid references public.post_comments(id) on delete cascade,
  reporter_id uuid not null references public.users(id) on delete cascade,
  reason      text,
  resolved    boolean not null default false,
  created_at  timestamptz not null default now(),
  -- Exactly one target.
  constraint post_reports_one_target check (num_nonnulls(post_id, comment_id) = 1)
);
create index if not exists post_reports_open_idx on public.post_reports(created_at desc) where not resolved;
create unique index if not exists post_reports_once_post_key
  on public.post_reports(post_id, reporter_id) where post_id is not null;
create unique index if not exists post_reports_once_comment_key
  on public.post_reports(comment_id, reporter_id) where comment_id is not null;

-- File a report. Runs as definer so it can notify admins, which the reporter
-- has no rights to do directly.
create or replace function public.report_content(
  p_post_id uuid, p_comment_id uuid, p_reason text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_admin record;
  v_body  text;
begin
  if v_uid is null then
    return jsonb_build_object('status', 'denied', 'message', 'Sign in to report this.');
  end if;
  if num_nonnulls(p_post_id, p_comment_id) <> 1 then
    return jsonb_build_object('status', 'denied', 'message', 'Nothing to report.');
  end if;

  insert into public.post_reports (post_id, comment_id, reporter_id, reason)
  values (p_post_id, p_comment_id, v_uid, nullif(trim(coalesce(p_reason, '')), ''))
  on conflict do nothing;

  if not found then
    -- Already reported by this person; don't notify admins twice.
    return jsonb_build_object('status', 'ok', 'message', 'You already reported this.');
  end if;

  v_body := coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'No reason given.');

  for v_admin in
    select ur.user_id from public.user_roles ur where ur.role = 'admin'
  loop
    perform public.notify(v_admin.user_id, 'report', 'Content reported',
      v_body, '/admin?tab=reports');
  end loop;

  return jsonb_build_object('status', 'ok', 'message', 'Reported. Thanks — an admin will take a look.');
end;
$$;

-- Admin: close a report out.
create or replace function public.resolve_report(p_report_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  update public.post_reports set resolved = true where id = p_report_id;
end;
$$;

revoke all on function public.report_content(uuid, uuid, text) from public;
grant execute on function public.report_content(uuid, uuid, text) to authenticated;

revoke all on function public.resolve_report(uuid) from public;
grant execute on function public.resolve_report(uuid) to authenticated;

alter table public.post_reports enable row level security;

drop policy if exists "admin reads reports" on public.post_reports;
create policy "admin reads reports" on public.post_reports
  for select using (public.is_admin() or auth.uid() = reporter_id);



-- ---------- Seed a session group so it is never empty ----------
-- An empty group is worse than no group: the first attendee to arrive sees a
-- dead room. The first check-in for an event leaves a pinned opener, posted as
-- the event's host (or an admin if the event has none).
create or replace function public.ensure_group_seed_post(p_event_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_event  public.events;
  v_author uuid;
  v_name   text;
begin
  if p_event_id is null then return; end if;
  if exists (select 1 from public.posts where event_id = p_event_id) then return; end if;

  select * into v_event from public.events where id = p_event_id;
  if not found then return; end if;

  v_author := v_event.host_id;
  if v_author is null then
    select ur.user_id into v_author from public.user_roles ur where ur.role = 'admin' limit 1;
  end if;
  if v_author is null then return; end if;  -- nobody to attribute it to

  select coalesce(full_name, 'Techxfluence') into v_name from public.users where id = v_author;

  insert into public.posts (author_id, author_name, author_role, body, pinned, channel, event_id)
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
    p_event_id
  );
end;
$$;

revoke all on function public.ensure_group_seed_post(uuid) from public;



-- ---------- Event discovery ----------
-- Hosts tag their own events at submission; approval carries the tags across.
alter table public.host_submissions add column if not exists tags text[] not null default '{}';

-- Hosts state their own start/end time. Without this every approved submission
-- inherited a hardcoded "10:00 AM - 1:00 PM IST" regardless of reality.
-- "time" is a keyword, so it is quoted here; the grammar for ADD COLUMN can
-- otherwise try to read it as the start of a type name.
alter table public.host_submissions add column if not exists "time" text;

-- Tags are the segments the seven fixed categories can't express — "react",
-- "beginner", "students welcome". Normalised to lowercase on write by the app.
alter table public.events add column if not exists tags text[] not null default '{}';
create index if not exists events_tags_idx on public.events using gin(tags);
