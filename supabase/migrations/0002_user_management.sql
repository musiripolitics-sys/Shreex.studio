-- ============================================================
-- Techxfluence — user management policies
-- Lets admins read/manage user_roles and update any profile.
-- Run in the Supabase SQL Editor.
-- ============================================================

-- Users can read their own roles; admins can read everyone's.
create policy "read own roles" on public.user_roles
  for select using (auth.uid() = user_id or public.is_admin());

-- Admins can grant/revoke roles.
create policy "admin manage roles" on public.user_roles
  for all using (public.is_admin()) with check (public.is_admin());

-- Admins can update any profile (e.g. change primary_role).
create policy "admin update users" on public.users
  for update using (public.is_admin()) with check (public.is_admin());
