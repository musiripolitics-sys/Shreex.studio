-- ============================================================
-- Techxfluence — reset the 3 test logins (idempotent).
-- Use INSTEAD of seed_test_users.sql when the accounts already exist.
-- Password for all three:  Password123!
-- ============================================================

-- 1. Reset passwords + make sure the emails are confirmed so they can sign in.
update auth.users
set encrypted_password = crypt('Password123!', gen_salt('bf')),
    email_confirmed_at = coalesce(email_confirmed_at, now()),
    updated_at = now()
where email in ('member@txf.test', 'host@txf.test', 'admin@txf.test');

-- 2. Make sure a public.users profile row exists for each (in case it's missing).
insert into public.users (id, email, full_name, city, primary_role)
select u.id, u.email,
       case u.email when 'member@txf.test' then 'Test Member'
                    when 'host@txf.test'   then 'Test Host'
                    else 'Test Admin' end,
       'Chennai', 'community_member'
from auth.users u
where u.email in ('member@txf.test', 'host@txf.test', 'admin@txf.test')
on conflict (id) do nothing;

-- 3. Put each account back on its intended role.
update public.users set primary_role = 'community_member', host_status = 'none'
  where email = 'member@txf.test';

update public.users set primary_role = 'event_host', host_status = 'approved'
  where email = 'host@txf.test';

update public.users set primary_role = 'admin', host_status = 'none'
  where email = 'admin@txf.test';

-- 4. Belt-and-suspenders admin grant (is_admin() honours either path).
insert into public.user_roles (user_id, role)
select id, 'admin' from public.users where email = 'admin@txf.test'
on conflict do nothing;

-- 5. Confirm the result.
select email, primary_role, host_status from public.users
where email in ('member@txf.test', 'host@txf.test', 'admin@txf.test')
order by email;
