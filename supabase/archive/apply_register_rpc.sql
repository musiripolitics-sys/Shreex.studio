-- ============================================================
-- Techxfluence — atomic event registration (fixes spots_left)
-- Registers an attendee AND decrements capacity in one locked
-- transaction. SECURITY DEFINER so it works regardless of the
-- caller's RLS (members/guests can't UPDATE events directly).
-- p_payment_id links a paid ticket to its payments row.
-- Run in the Supabase SQL Editor. Idempotent.
-- ============================================================

-- Drop the earlier 4-arg version if it was already applied.
drop function if exists public.register_for_event(uuid, text, text, text);

create or replace function public.register_for_event(
  p_event_id uuid,
  p_attendee_name text,
  p_attendee_email text,
  p_attendee_phone text default null,
  p_payment_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_spots  int;
  v_status event_status;
  v_ticket text;
  v_uid    uuid := auth.uid();
begin
  -- Lock the event row so concurrent registrations can't oversell.
  select spots_left, status into v_spots, v_status
  from public.events
  where id = p_event_id
  for update;

  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  if v_status <> 'published' then raise exception 'EVENT_NOT_OPEN'; end if;
  if v_spots <= 0 then raise exception 'EVENT_FULL'; end if;

  insert into public.registrations
    (event_id, user_id, attendee_name, attendee_email, attendee_phone, status, payment_id)
  values
    (p_event_id, v_uid, p_attendee_name, p_attendee_email, p_attendee_phone, 'registered', p_payment_id)
  returning ticket_code into v_ticket;

  update public.events set spots_left = spots_left - 1 where id = p_event_id;

  return v_ticket;
exception
  when unique_violation then
    raise exception 'ALREADY_REGISTERED';
end;
$$;

revoke all on function public.register_for_event(uuid, text, text, text, uuid) from public;
grant execute on function public.register_for_event(uuid, text, text, text, uuid) to anon, authenticated;
