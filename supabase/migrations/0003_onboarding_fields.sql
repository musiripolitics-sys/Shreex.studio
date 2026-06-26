-- ============================================================
-- Techxfluence — capture more profile data at signup
-- Updates handle_new_user() to also persist phone + city from
-- the signup metadata. Run in the Supabase SQL Editor.
-- ============================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email, full_name, phone, city)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    nullif(new.raw_user_meta_data->>'phone', ''),
    nullif(new.raw_user_meta_data->>'city', '')
  )
  on conflict (id) do nothing;
  return new;
end; $$;
