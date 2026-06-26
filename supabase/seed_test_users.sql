-- ============================================================
-- Techxfluence — seed 3 test logins (Member / Host / Admin)
-- Run in the Supabase SQL Editor. Password for all three:  Password123!
--   member@txf.test  → Community Member
--   host@txf.test    → Host (approved)
--   admin@txf.test   → Admin
-- ============================================================
do $$
declare
  member_id uuid := gen_random_uuid();
  host_id   uuid := gen_random_uuid();
  admin_id  uuid := gen_random_uuid();
  rec record;
begin
  for rec in
    select * from (values
      (member_id, 'member@txf.test', 'Test Member', 'community_member'),
      (host_id,   'host@txf.test',   'Test Host',   'event_host'),
      (admin_id,  'admin@txf.test',  'Test Admin',  'community_member')
    ) as t(id, email, full_name, signup_role)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change, email_change_token_new
    ) values (
      '00000000-0000-0000-0000-000000000000', rec.id, 'authenticated', 'authenticated',
      rec.email, crypt('Password123!', gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', rec.full_name, 'role', rec.signup_role,
                         'city', 'Chennai', 'phone', '+910000000000'),
      '', '', '', ''
    );

    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), rec.id,
      jsonb_build_object('sub', rec.id::text, 'email', rec.email, 'email_verified', true),
      'email', rec.id::text, now(), now(), now()
    );
  end loop;

  -- The handle_new_user trigger created the public.users rows. Finalise roles:
  update public.users set primary_role = 'event_host', host_status = 'approved' where id = host_id;
  update public.users set primary_role = 'admin',      host_status = 'none'     where id = admin_id;

  -- Belt-and-suspenders admin grant (is_admin() honors either path)
  insert into public.user_roles (user_id, role) values (admin_id, 'admin') on conflict do nothing;
end $$;
