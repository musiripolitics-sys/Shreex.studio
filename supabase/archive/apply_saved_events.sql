-- ============================================================
-- Techxfluence — save / wishlist events.
-- A member bookmarks events they're interested in but not ready
-- to register for. Purely per-user: nobody sees anyone else's list.
-- Run once. Idempotent.
-- ============================================================
create table if not exists public.saved_events (
  user_id    uuid not null references public.users(id) on delete cascade,
  event_id   uuid not null references public.events(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, event_id)
);
create index if not exists idx_saved_events_user
  on public.saved_events (user_id, created_at desc);

alter table public.saved_events enable row level security;

drop policy if exists "read own saved" on public.saved_events;
create policy "read own saved" on public.saved_events
  for select using (auth.uid() = user_id);

drop policy if exists "save own" on public.saved_events;
create policy "save own" on public.saved_events
  for insert with check (auth.uid() = user_id);

drop policy if exists "unsave own" on public.saved_events;
create policy "unsave own" on public.saved_events
  for delete using (auth.uid() = user_id);
