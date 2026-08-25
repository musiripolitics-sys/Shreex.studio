-- ============================================================
-- Techxfluence — attendance points + points-gated directory. Idempotent.
--   • +10 points to a member each time they're checked in to a session.
--   • Directory lists opted-in members who have >= 100 points OR are Elite.
-- ============================================================

-- ---------- Check-in RPC (marks attended + awards 10 points) ----------
-- Runs as definer so a host can update the *attendee's* points (their own RLS
-- can't). Authorization (admin or the event's host) is enforced inside.
create or replace function public.check_in_ticket(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_reg   public.registrations;
  v_event public.events;
begin
  select * into v_reg from public.registrations
    where lower(ticket_code) = lower(trim(p_code))
    limit 1;
  if not found then
    return jsonb_build_object('status', 'invalid',
      'message', 'Ticket not found — or not for one of your events.');
  end if;

  select * into v_event from public.events where id = v_reg.event_id;

  -- Only an admin or the event's host may check this ticket in.
  if not (public.is_admin() or v_event.host_id = v_uid) then
    return jsonb_build_object('status', 'invalid',
      'message', 'Ticket not found — or not for one of your events.');
  end if;

  if v_reg.checked_in_at is not null or v_reg.status = 'attended' then
    return jsonb_build_object('status', 'already', 'message', 'Already checked in',
      'attendeeName', v_reg.attendee_name, 'eventTitle', v_event.title,
      'checkedInAt', v_reg.checked_in_at);
  end if;

  update public.registrations
    set status = 'attended', checked_in_at = now()
    where id = v_reg.id;

  -- Award 10 attendance points to the member (guests with no account get none).
  if v_reg.user_id is not null then
    update public.users set points = points + 10 where id = v_reg.user_id;
  end if;

  return jsonb_build_object('status', 'ok', 'message', 'Checked in',
    'attendeeName', v_reg.attendee_name, 'eventTitle', v_event.title);
end;
$$;

revoke all on function public.check_in_ticket(text) from public;
grant execute on function public.check_in_ticket(text) to authenticated;

-- ---------- Directory: eligible = opted-in AND (>=100 points OR Elite) ----------
create or replace function public.get_directory()
returns table (
  id uuid, full_name text, city text, bio text, linkedin_url text, primary_role text
)
language sql
security definer
set search_path = public
as $$
  select u.id, u.full_name, u.city, u.bio, u.linkedin_url, u.primary_role::text
  from public.users u
  where u.discoverable = true
    and (
      u.points >= 100
      or exists (
        select 1 from public.memberships m
        where m.user_id = u.id and m.tier = 'Elite' and m.status = 'active'
      )
    )
  order by u.full_name;
$$;

revoke all on function public.get_directory() from public;
grant execute on function public.get_directory() to authenticated;
