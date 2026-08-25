-- ============================================================
-- Techxfluence — public organizer profiles + follow.
-- users is private, so the public profile is served by a
-- SECURITY DEFINER function exposing only safe fields, and only
-- for people who actually host published events.
-- Run once. Idempotent.
-- ============================================================

create table if not exists public.organizer_follows (
  follower_id  uuid not null references public.users(id) on delete cascade,
  organizer_id uuid not null references public.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, organizer_id)
);
create index if not exists idx_follows_organizer
  on public.organizer_follows (organizer_id);

alter table public.organizer_follows enable row level security;

drop policy if exists "read own follows" on public.organizer_follows;
create policy "read own follows" on public.organizer_follows
  for select using (auth.uid() = follower_id or auth.uid() = organizer_id);

drop policy if exists "follow own" on public.organizer_follows;
create policy "follow own" on public.organizer_follows
  for insert with check (auth.uid() = follower_id);

drop policy if exists "unfollow own" on public.organizer_follows;
create policy "unfollow own" on public.organizer_follows
  for delete using (auth.uid() = follower_id);

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
grant execute on function public.get_organizer(uuid) to anon, authenticated;

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
revoke all on function public.notify_followers(uuid) from public;
grant execute on function public.notify_followers(uuid) to authenticated;
