-- ============================================================
-- A comment thread on each task.
--
-- tasks.comments is a single text field, which works for a standing note
-- but cannot hold a conversation: no author, no time, and every edit
-- overwrites whatever was there. This adds a proper thread so the task
-- detail view can show who said what and when.
--
-- Idempotent. Run AFTER 0007.
-- ============================================================
create table if not exists public.task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks(id) on delete cascade,
  author_id  uuid references public.users(id) on delete set null,
  body       text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists task_comments_task_idx
  on public.task_comments(task_id, created_at);

drop trigger if exists trg_task_comments_updated on public.task_comments;
create trigger trg_task_comments_updated before update on public.task_comments
  for each row execute function public.set_updated_at();

alter table public.task_comments enable row level security;

-- Staff read the thread; an author edits or deletes only their own comment,
-- and an admin can remove anything.
drop policy if exists "staff read task comments" on public.task_comments;
create policy "staff read task comments" on public.task_comments
  for select using (public.bos_is_staff() or public.is_admin());

drop policy if exists "staff write task comments" on public.task_comments;
create policy "staff write task comments" on public.task_comments
  for insert with check (
    (public.bos_is_staff() or public.is_admin()) and author_id = auth.uid()
  );

drop policy if exists "edit own task comment" on public.task_comments;
create policy "edit own task comment" on public.task_comments
  for update using (author_id = auth.uid()) with check (author_id = auth.uid());

drop policy if exists "delete own task comment" on public.task_comments;
create policy "delete own task comment" on public.task_comments
  for delete using (author_id = auth.uid() or public.is_admin());
