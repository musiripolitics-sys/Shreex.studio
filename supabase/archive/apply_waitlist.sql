-- ============================================================
-- Techxfluence — waitlist + cancellation (atomic, race-safe).
-- Run once in the Supabase SQL Editor. Idempotent.
-- ============================================================

-- ---------- Join the waitlist (does NOT take a seat) ----------
create or replace function public.join_waitlist(
  p_event_id uuid,
  p_attendee_name text,
  p_attendee_email text,
  p_attendee_phone text default null
)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_status event_status;
  v_ticket text;
  v_uid uuid := auth.uid();
begin
  select status into v_status from public.events where id = p_event_id;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  if v_status <> 'published' then raise exception 'EVENT_NOT_OPEN'; end if;

  insert into public.registrations
    (event_id, user_id, attendee_name, attendee_email, attendee_phone, status)
  values
    (p_event_id, v_uid, p_attendee_name, p_attendee_email, p_attendee_phone, 'waitlisted')
  returning ticket_code into v_ticket;

  return v_ticket;
exception
  when unique_violation then raise exception 'ALREADY_REGISTERED';
end;
$$;

-- ---------- Cancel a registration (frees seat or promotes waitlist) ----------
create or replace function public.cancel_registration(p_registration_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_reg public.registrations;
  v_uid uuid := auth.uid();
  v_promoted public.registrations;
  v_did_promote boolean := false;
  v_event_title text;
begin
  select * into v_reg from public.registrations
    where id = p_registration_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;

  -- Only the owner, an admin, or the event's host may cancel.
  if v_reg.user_id is distinct from v_uid
     and not public.is_admin()
     and not exists (
       select 1 from public.events e
       where e.id = v_reg.event_id and e.host_id = v_uid
     ) then
    raise exception 'FORBIDDEN';
  end if;

  -- Lock the event row before touching capacity.
  perform 1 from public.events where id = v_reg.event_id for update;

  -- A confirmed registration was holding a seat: promote the next waitlister,
  -- otherwise return the seat to the pool.
  if v_reg.status = 'registered' then
    select * into v_promoted from public.registrations
      where event_id = v_reg.event_id and status = 'waitlisted'
      order by registered_at asc
      limit 1
      for update;
    if found then
      update public.registrations set status = 'registered' where id = v_promoted.id;
      v_did_promote := true;
    else
      update public.events set spots_left = spots_left + 1 where id = v_reg.event_id;
    end if;
  end if;

  delete from public.registrations where id = v_reg.id;

  if v_did_promote then
    select title into v_event_title from public.events where id = v_reg.event_id;
    return jsonb_build_object(
      'ok', true,
      'promoted', jsonb_build_object(
        'email', v_promoted.attendee_email,
        'name', v_promoted.attendee_name,
        'ticket', v_promoted.ticket_code,
        'event_title', v_event_title
      )
    );
  end if;

  return jsonb_build_object('ok', true, 'promoted', null);
end;
$$;

revoke all on function public.join_waitlist(uuid, text, text, text) from public;
grant execute on function public.join_waitlist(uuid, text, text, text) to anon, authenticated;
revoke all on function public.cancel_registration(uuid) from public;
grant execute on function public.cancel_registration(uuid) to authenticated;
