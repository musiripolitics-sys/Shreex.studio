-- Seed Priyanka (Manager) onto the leadership board for already-deployed DBs.
-- Idempotent: only runs when the leadership board is populated but Priyanka is absent.
do $$
begin
  if exists (select 1 from public.leader_profiles)
     and not exists (
       select 1 from public.leader_profiles where display_name = 'Priyanka'
     ) then
    -- Make room right after the Founder (sort_order 1).
    update public.leader_profiles set sort_order = sort_order + 1 where sort_order >= 2;

    insert into public.leader_profiles
      (display_name, role, city, focus, bio, events_count, points, is_hiring, image_url, sort_order)
    values
      ('Priyanka', 'Manager', 'Chennai', 'Operations & Programs',
        'Keeping Techxfluence running — coordinating events, partnerships and the team behind every gathering.',
        28, 5200, false, '/team/priyanka.jpg', 2);
  end if;
end $$;
