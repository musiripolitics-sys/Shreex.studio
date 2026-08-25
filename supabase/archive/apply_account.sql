-- ============================================================
-- Techxfluence — keep public.users.email in sync after an
-- email change is confirmed in auth.users. Run once. Idempotent.
-- ============================================================
create or replace function public.sync_user_email()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is distinct from old.email then
    update public.users set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_user_email on auth.users;
create trigger trg_sync_user_email
  after update of email on auth.users
  for each row execute function public.sync_user_email();
