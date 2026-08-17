-- Adds the "Manager" leadership role and seeds Priyanka onto the board.
-- Safe to run once in the Supabase Dashboard → SQL Editor (single transaction).
-- Idempotent: re-running will not duplicate Priyanka.

-- 1) Add 'Manager' to the leader_role enum (recreate so it's usable immediately
--    in this same transaction; only leader_profiles.role uses this type).
do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'leader_role' and e.enumlabel = 'Manager'
  ) then
    alter type leader_role rename to leader_role_old;
    create type leader_role as enum
      ('Founder','Manager','Community Lead','Event Coordinator','Ambassador','Mentor');
    alter table public.leader_profiles
      alter column role type leader_role using role::text::leader_role;
    drop type leader_role_old;
  end if;
end $$;

-- 2) Seed Priyanka right after the Founder (if she isn't already there).
do $$
begin
  if not exists (
    select 1 from public.leader_profiles where display_name = 'Priyanka'
  ) then
    update public.leader_profiles set sort_order = sort_order + 1 where sort_order >= 2;

    insert into public.leader_profiles
      (display_name, role, city, focus, bio, events_count, points, is_hiring, image_url, sort_order)
    values
      ('Priyanka', 'Manager', 'Chennai', 'Operations & Programs',
        'Keeping Techxfluence running — coordinating events, partnerships and the team behind every gathering.',
        28, 5200, false, '/team/priyanka.jpg', 2);
  end if;
end $$;
