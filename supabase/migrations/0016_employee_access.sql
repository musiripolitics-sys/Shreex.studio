-- ============================================================
-- Per-employee access to Business OS sections.
--
-- Until now the OS was all-or-nothing: admin saw everything, nobody else
-- saw anything. This grants an employee named sections — Plan, Events,
-- Money, Grow, Marketing, Team, Product, Govern, Insights — and the nav,
-- the dashboard and the pages themselves follow the grant.
--
-- Admins are never listed here. is_admin() short-circuits every check, so
-- an admin cannot lock themselves out by forgetting to grant themselves
-- something, and revoking the last grant from an admin does nothing.
--
-- Idempotent. Run AFTER 0007.
-- ============================================================

create table if not exists public.employee_module_access (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  section    text not null check (section in (
               'plan','events','money','grow','marketing',
               'team','product','govern','insights')),
  granted_by uuid references public.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  unique (user_id, section)
);

create index if not exists employee_module_access_user_idx
  on public.employee_module_access(user_id);

alter table public.employee_module_access enable row level security;

-- Only an admin changes grants. Everyone may read their own, because the
-- nav has to know what to render.
drop policy if exists "admin manage module access" on public.employee_module_access;
create policy "admin manage module access" on public.employee_module_access
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "read own module access" on public.employee_module_access;
create policy "read own module access" on public.employee_module_access
  for select using (user_id = auth.uid() or public.is_admin());

-- ------------------------------------------------------------
-- What may the caller see?
-- ------------------------------------------------------------
create or replace function public.bos_my_sections()
returns text[]
language plpgsql
security definer
stable
set search_path = public
as $$
declare v_all text[] := array[
  'plan','events','money','grow','marketing','team','product','govern','insights'];
begin
  if auth.uid() is null then
    return array[]::text[];
  end if;
  -- An admin always has everything, granted or not.
  if public.is_admin() then
    return v_all;
  end if;
  return coalesce(
    (select array_agg(section order by section)
       from public.employee_module_access
      where user_id = auth.uid()),
    array[]::text[]);
end $$;

comment on function public.bos_my_sections() is
  $c$Section keys the signed-in user may open. Admins get all nine.$c$;

create or replace function public.bos_can_access(p_section text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.is_admin()
      or exists (
           select 1 from public.employee_module_access
            where user_id = auth.uid() and section = p_section);
$$;

revoke all on function public.bos_my_sections() from public;
revoke all on function public.bos_can_access(text) from public;
grant execute on function public.bos_my_sections() to authenticated;
grant execute on function public.bos_can_access(text) to authenticated;

-- ------------------------------------------------------------
-- Replace a user's grants in one call, so the admin UI never has to
-- reconcile adds and removes itself.
-- ------------------------------------------------------------
create or replace function public.bos_set_module_access(p_user uuid, p_sections text[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_count int;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_user = auth.uid() then
    raise exception 'CANNOT_EDIT_OWN_ACCESS';
  end if;

  delete from public.employee_module_access
   where user_id = p_user
     and (p_sections is null or section <> all(p_sections));

  insert into public.employee_module_access (user_id, section, granted_by)
  select p_user, s, auth.uid()
    from unnest(coalesce(p_sections, array[]::text[])) s
  on conflict (user_id, section) do nothing;

  select count(*) into v_count
    from public.employee_module_access where user_id = p_user;
  return v_count;
end $$;

revoke all on function public.bos_set_module_access(uuid, text[]) from public;
grant execute on function public.bos_set_module_access(uuid, text[]) to authenticated;
