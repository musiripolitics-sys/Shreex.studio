-- ============================================================
-- Techxfluence — likes + comments for the community feed. Run once. Idempotent.
-- ============================================================

-- ---------- Likes (one per user per post) ----------
create table if not exists public.post_reactions (
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table public.post_reactions enable row level security;

drop policy if exists "read reactions" on public.post_reactions;
create policy "read reactions" on public.post_reactions
  for select using (auth.uid() is not null);

drop policy if exists "like own" on public.post_reactions;
create policy "like own" on public.post_reactions
  for insert with check (auth.uid() = user_id);

drop policy if exists "unlike own" on public.post_reactions;
create policy "unlike own" on public.post_reactions
  for delete using (auth.uid() = user_id);

-- ---------- Comments ----------
create table if not exists public.post_comments (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.posts(id) on delete cascade,
  author_id   uuid not null references public.users(id) on delete cascade,
  author_name text not null,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_comments_post on public.post_comments (post_id, created_at);
alter table public.post_comments enable row level security;

drop policy if exists "read comments" on public.post_comments;
create policy "read comments" on public.post_comments
  for select using (auth.uid() is not null);

drop policy if exists "comment own" on public.post_comments;
create policy "comment own" on public.post_comments
  for insert with check (auth.uid() = author_id);

drop policy if exists "delete own comment or admin" on public.post_comments;
create policy "delete own comment or admin" on public.post_comments
  for delete using (auth.uid() = author_id or public.is_admin());
