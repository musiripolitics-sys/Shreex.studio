-- ============================================================
-- Techxfluence — community channels + attendee-only session groups.
-- Run once. Idempotent.
--   • Topic channels (event_id null): 'all', 'meetups', 'tech' — any member.
--   • Session groups (event_id set): only attendees of that event (status
--     'attended') or admins can read/post. Enforced by RLS.
-- ============================================================
alter table public.posts add column if not exists channel text not null default 'all';
alter table public.posts add column if not exists event_id uuid references public.events(id) on delete cascade;
create index if not exists idx_posts_channel on public.posts (channel, created_at desc);
create index if not exists idx_posts_event on public.posts (event_id, created_at desc);

-- Did the current user attend (check in to) this event?
create or replace function public.attended(p_event_id uuid)
returns boolean
language sql security definer stable set search_path = public
as $$
  select exists (
    select 1 from public.registrations r
    where r.event_id = p_event_id and r.user_id = auth.uid() and r.status = 'attended'
  );
$$;
grant execute on function public.attended(uuid) to authenticated;

-- ---------- posts: gate session groups by attendance ----------
drop policy if exists "read posts" on public.posts;
create policy "read posts" on public.posts for select using (
  auth.uid() is not null
  and (event_id is null or public.is_admin() or public.attended(event_id))
);

drop policy if exists "create own post" on public.posts;
create policy "create own post" on public.posts for insert with check (
  auth.uid() = author_id
  and (event_id is null or public.is_admin() or public.attended(event_id))
);

-- ---------- comments: inherit the parent post's visibility ----------
drop policy if exists "read comments" on public.post_comments;
create policy "read comments" on public.post_comments for select using (
  exists (
    select 1 from public.posts p
    where p.id = post_comments.post_id
      and (p.event_id is null or public.is_admin() or public.attended(p.event_id))
  )
);

drop policy if exists "comment own" on public.post_comments;
create policy "comment own" on public.post_comments for insert with check (
  auth.uid() = author_id and exists (
    select 1 from public.posts p
    where p.id = post_comments.post_id
      and (p.event_id is null or public.is_admin() or public.attended(p.event_id))
  )
);

-- ---------- reactions: inherit the parent post's visibility ----------
drop policy if exists "read reactions" on public.post_reactions;
create policy "read reactions" on public.post_reactions for select using (
  exists (
    select 1 from public.posts p
    where p.id = post_reactions.post_id
      and (p.event_id is null or public.is_admin() or public.attended(p.event_id))
  )
);

drop policy if exists "like own" on public.post_reactions;
create policy "like own" on public.post_reactions for insert with check (
  auth.uid() = user_id and exists (
    select 1 from public.posts p
    where p.id = post_reactions.post_id
      and (p.event_id is null or public.is_admin() or public.attended(p.event_id))
  )
);
