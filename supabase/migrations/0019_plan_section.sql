-- ============================================================
-- Two things the Plan section audit turned up.
--
-- 1. Nobody has a name.
--    "read own profile" on public.users is `auth.uid() = id or is_admin()`,
--    so an employee's owner lookup returns exactly one row: themselves. Every
--    other row on their roadmap renders "—". That defeats the point of 0018,
--    which went to the trouble of making a blocker readable so the board could
--    say "waiting on T-005 (Farid)" rather than "waiting on something".
--    Widening the policy would hand every employee the staff email list, so
--    the directory is a security definer function instead: names for staff,
--    emails only for admins.
--
-- 2. An employee cannot close their own task's review.
--    0018 lets them read the review their completed task opened, but there is
--    no update policy, so the form on the Reviews page can only fail. Since
--    employees already edit the tasks they own, they may finish the retro on
--    them too.
--
-- Idempotent. Run AFTER 0018.
-- ============================================================

-- ------------------------------------------------------------
-- Who may be named
-- ------------------------------------------------------------
create or replace function public.bos_user_directory()
returns table (id uuid, full_name text, email text, primary_role text)
language sql
security definer          -- reads users with RLS bypassed, then re-narrows
stable
set search_path = public
as $$
  select u.id,
         u.full_name,
         -- An address is contact data, not a label. Staff get the name only.
         case when public.is_admin() then u.email else null end,
         u.primary_role::text
    from public.users u
   where public.is_admin()
      -- A colleague is nameable; a member is not, and never appears in the
      -- Business OS at all.
      or (public.bos_is_staff()
          and u.primary_role::text in ('admin', 'employee', 'event_host'));
$$;

revoke all on function public.bos_user_directory() from public;
grant execute on function public.bos_user_directory() to authenticated;

-- ------------------------------------------------------------
-- An owner may finish the review their own task opened
-- ------------------------------------------------------------
drop policy if exists "owner update own task review" on public.task_reviews;
create policy "owner update own task review" on public.task_reviews
  for update
  using (
    public.is_admin()
    or exists (select 1 from public.tasks t
                where t.id = task_id and t.owner_id = auth.uid())
  )
  with check (
    public.is_admin()
    or exists (select 1 from public.tasks t
                where t.id = task_id and t.owner_id = auth.uid())
  );
