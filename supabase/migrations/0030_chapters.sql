-- ============================================================
-- Chapters, which the site already links to and the database never had.
--
-- /communities is in the public navigation, src/lib/communities.ts queries
-- these tables, and a test suite covers them — but the tables only ever
-- existed in schema.sql, which this database has not had run against it in
-- full. The library swallows the missing-table error and returns an empty
-- list, so the page renders its shell with nothing in it. A chapter feature
-- that is advertised in the nav and shows nothing is worse than one that is
-- not advertised.
--
-- This is the communities section of schema.sql, lifted unchanged so the two
-- cannot drift: enums, both tables, the member-count trigger, join and leave,
-- the visibility helpers, and the RLS that depends on them.
--
-- Idempotent. Run AFTER 0029.
-- ============================================================

-- Communities (chapters)
-- ============================================================
-- The persistent layer above session groups. A session group is private to
-- the people who attended one event; a community is a city or topic chapter
-- you join once and come back to. Events may belong to one, but don't have to
-- — community_id is nullable so standalone events keep publishing.

do $$ begin
  create type community_kind   as enum ('city','topic');
exception when duplicate_object then null; end $$;

do $$ begin
  create type community_role   as enum ('organizer','co_organizer','host','member');
exception when duplicate_object then null; end $$;

do $$ begin
  create type membership_state as enum ('active','pending','blocked');
exception when duplicate_object then null; end $$;

create table if not exists public.communities (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,
  name            text not null,
  kind            community_kind not null default 'city',
  city            text,
  tagline         text,
  description     text,
  cover_image     text,
  topics          text[] not null default '{}',
  is_public       boolean not null default true,
  join_policy     text not null default 'open',   -- 'open' | 'approval'
  welcome_message text,
  member_count    int not null default 0,
  status          text not null default 'published', -- 'draft' | 'published'
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists communities_kind_idx on public.communities(kind);
create index if not exists communities_city_idx on public.communities(city);

create table if not exists public.community_members (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  role         community_role not null default 'member',
  state        membership_state not null default 'active',
  joined_at    timestamptz not null default now(),
  primary key (community_id, user_id)
);
create index if not exists community_members_user_idx on public.community_members(user_id);

-- Events optionally belong to a chapter; posts can be scoped to one.
alter table public.events add column if not exists community_id uuid
  references public.communities(id) on delete set null;
create index if not exists events_community_idx on public.events(community_id);

alter table public.posts add column if not exists community_id uuid
  references public.communities(id) on delete cascade;
create index if not exists posts_community_idx on public.posts(community_id);

-- ---------- Membership helpers ----------
create or replace function public.is_community_member(p_community uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.community_members m
     where m.community_id = p_community
       and m.user_id = auth.uid()
       and m.state = 'active'
  );
$$;

-- Can the caller read this chapter's content? Public chapters are readable by
-- any signed-in member; private ones only by people who joined.
create or replace function public.can_read_community(p_community uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_admin()
      or exists (select 1 from public.communities c
                  where c.id = p_community and c.is_public)
      or public.is_community_member(p_community);
$$;

create or replace function public.community_leads(p_community uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_admin() or exists (
    select 1 from public.community_members m
     where m.community_id = p_community
       and m.user_id = auth.uid()
       and m.state = 'active'
       and m.role in ('organizer','co_organizer')
  );
$$;

-- member_count is denormalised so cards and lists don't each count rows.
create or replace function public.sync_community_member_count()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_community uuid := coalesce(new.community_id, old.community_id);
begin
  update public.communities c
     set member_count = (
       select count(*) from public.community_members m
        where m.community_id = v_community and m.state = 'active')
   where c.id = v_community;
  return null;
end;
$$;

drop trigger if exists trg_community_member_count on public.community_members;
create trigger trg_community_member_count
  after insert or update or delete on public.community_members
  for each row execute function public.sync_community_member_count();

-- Joining. Honours the chapter's join policy and is idempotent.
create or replace function public.join_community(p_community uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_c   public.communities;
begin
  if v_uid is null then
    return jsonb_build_object('status','denied','message','Sign in to join.');
  end if;

  select * into v_c from public.communities where id = p_community;
  if not found or v_c.status <> 'published' then
    return jsonb_build_object('status','denied','message','Chapter not found.');
  end if;

  insert into public.community_members (community_id, user_id, role, state)
  values (p_community, v_uid, 'member',
          (case when v_c.join_policy = 'approval' then 'pending' else 'active' end)::membership_state)
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
end;
$$;

create or replace function public.leave_community(p_community uuid)
returns void
language sql security definer set search_path = public
as $$
  delete from public.community_members
   where community_id = p_community and user_id = auth.uid();
$$;

-- ---------- RLS ----------
alter table public.communities       enable row level security;
alter table public.community_members enable row level security;

drop policy if exists "read communities" on public.communities;
create policy "read communities" on public.communities
  for select using (
    status = 'published' and (is_public or public.is_community_member(id) or public.is_admin())
  );

drop policy if exists "admin writes communities" on public.communities;
create policy "admin writes communities" on public.communities
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "organizers update their community" on public.communities;
create policy "organizers update their community" on public.communities
  for update using (public.community_leads(id)) with check (public.community_leads(id));

-- Rosters are visible to people who can see the chapter.
drop policy if exists "read members" on public.community_members;
create policy "read members" on public.community_members
  for select using (public.can_read_community(community_id));

-- Membership rows are created through join_community(); leaving is your own.
drop policy if exists "leave own membership" on public.community_members;
create policy "leave own membership" on public.community_members
  for delete using (auth.uid() = user_id or public.community_leads(community_id));

drop policy if exists "leads manage members" on public.community_members;
create policy "leads manage members" on public.community_members
  for update using (public.community_leads(community_id))
  with check (public.community_leads(community_id));

-- Posts gain a third scope. A post lives in exactly one place: a global
-- channel, one event's session group, or one chapter.
drop policy if exists "read posts" on public.posts;
create policy "read posts" on public.posts for select using (
  auth.uid() is not null
  and (event_id is null or public.is_admin() or public.attended(event_id))
  and (community_id is null or public.can_read_community(community_id))
);

drop policy if exists "create own post" on public.posts;
create policy "create own post" on public.posts for insert with check (
  auth.uid() = author_id
  and (event_id is null or public.is_admin() or public.attended(event_id))
  -- Chapter posts require membership, not just visibility.
  and (community_id is null or public.is_admin() or public.is_community_member(community_id))
  and public.meets_gate(case when event_id is null then 'post_global' else 'post_group' end)
);

-- ---------- Grants ----------
grant execute on function public.is_community_member(uuid) to authenticated;
grant execute on function public.can_read_community(uuid)  to authenticated;
grant execute on function public.community_leads(uuid)     to authenticated;

revoke all on function public.join_community(uuid) from public;
grant execute on function public.join_community(uuid) to authenticated;

revoke all on function public.leave_community(uuid) from public;
grant execute on function public.leave_community(uuid) to authenticated;

revoke all on function public.sync_community_member_count() from public;


