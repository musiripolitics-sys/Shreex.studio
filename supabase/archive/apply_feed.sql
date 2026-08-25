-- ============================================================
-- Techxfluence — community feed (members-only posts). Run once. Idempotent.
-- author_name/role are denormalised so the feed never has to read the
-- private users table.
-- ============================================================
create table if not exists public.posts (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null references public.users(id) on delete cascade,
  author_name text not null,
  author_role text,
  body        text not null,
  pinned      boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists idx_posts_created on public.posts (created_at desc);

alter table public.posts enable row level security;

-- Any signed-in member can read the feed.
drop policy if exists "read posts" on public.posts;
create policy "read posts" on public.posts
  for select using (auth.uid() is not null);

-- Members post as themselves.
drop policy if exists "create own post" on public.posts;
create policy "create own post" on public.posts
  for insert with check (auth.uid() = author_id);

-- Only admins can pin/edit.
drop policy if exists "admin update posts" on public.posts;
create policy "admin update posts" on public.posts
  for update using (public.is_admin()) with check (public.is_admin());

-- Authors can delete their own; admins can delete any.
drop policy if exists "delete own or admin" on public.posts;
create policy "delete own or admin" on public.posts
  for delete using (auth.uid() = author_id or public.is_admin());
