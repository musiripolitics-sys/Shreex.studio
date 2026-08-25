-- ============================================================
-- Techxfluence — in-app notifications. Run once. Idempotent.
-- ============================================================
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  type       text not null default 'info',
  title      text not null,
  body       text,
  link       text,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_notif_user on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;

drop policy if exists "read own notifications" on public.notifications;
create policy "read own notifications" on public.notifications
  for select using (auth.uid() = user_id);
drop policy if exists "update own notifications" on public.notifications;
create policy "update own notifications" on public.notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "insert own notifications" on public.notifications;
create policy "insert own notifications" on public.notifications
  for insert with check (auth.uid() = user_id);

-- Internal helper to notify ANY user. Not granted to clients — only callable
-- from other SECURITY DEFINER functions (owned by the same role).
create or replace function public.notify(
  p_user_id uuid, p_type text, p_title text, p_body text default null, p_link text default null
) returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, type, title, body, link)
  values (p_user_id, p_type, p_title, p_body, p_link);
$$;
revoke all on function public.notify(uuid, text, text, text, text) from public;

-- Admin approves/rejects host access (gated) + notifies the user.
create or replace function public.decide_host(p_user_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_approve then
    update public.users set primary_role = 'event_host', host_status = 'approved' where id = p_user_id;
    perform public.notify(p_user_id, 'host', 'You''re now a Host 🎉',
      'Your host access was approved — you can submit and manage events.', '/host/dashboard');
  else
    update public.users set host_status = 'rejected' where id = p_user_id;
    perform public.notify(p_user_id, 'host', 'Host request update',
      'Your host access request wasn''t approved this time.', null);
  end if;
end; $$;
revoke all on function public.decide_host(uuid, boolean) from public;
grant execute on function public.decide_host(uuid, boolean) to authenticated;

-- Recreate cancel_registration to notify a promoted waitlister.
create or replace function public.cancel_registration(p_registration_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_reg public.registrations; v_uid uuid := auth.uid();
  v_promoted public.registrations; v_did_promote boolean := false;
  v_event_title text; v_slug text;
begin
  select * into v_reg from public.registrations where id = p_registration_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_reg.user_id is distinct from v_uid and not public.is_admin()
     and not exists (select 1 from public.events e where e.id = v_reg.event_id and e.host_id = v_uid) then
    raise exception 'FORBIDDEN';
  end if;
  perform 1 from public.events where id = v_reg.event_id for update;
  if v_reg.status = 'registered' then
    select * into v_promoted from public.registrations
      where event_id = v_reg.event_id and status = 'waitlisted'
      order by registered_at asc limit 1 for update;
    if found then
      update public.registrations set status = 'registered' where id = v_promoted.id;
      v_did_promote := true;
    else
      update public.events set spots_left = spots_left + 1 where id = v_reg.event_id;
    end if;
  end if;
  delete from public.registrations where id = v_reg.id;
  if v_did_promote then
    select title, slug into v_event_title, v_slug from public.events where id = v_reg.event_id;
    if v_promoted.user_id is not null then
      perform public.notify(v_promoted.user_id, 'waitlist', 'You''re off the waitlist! 🎉',
        'A spot opened up for ' || v_event_title || ' — you''re confirmed.', '/events/' || v_slug);
    end if;
    return jsonb_build_object('ok', true, 'promoted', jsonb_build_object(
      'email', v_promoted.attendee_email, 'name', v_promoted.attendee_name,
      'ticket', v_promoted.ticket_code, 'event_title', v_event_title));
  end if;
  return jsonb_build_object('ok', true, 'promoted', null);
end; $$;
