-- ============================================================
-- Phase 1: the Business OS becomes the place events are edited.
--
-- Until now the OS could read events and write an ops overlay beside them,
-- but the event itself — the thing the website renders — could only be
-- changed by an admin through the old console. An employee granted the Events
-- section could not even see a draft, because the only read policy is for
-- published rows.
--
-- So: staff with the Events section may manage events, and read the
-- registrations behind them, which is what a ticket count is made of.
-- Everyone else is unchanged; the public still sees published rows only.
--
-- Idempotent. Run AFTER 0025.
-- ============================================================

-- ------------------------------------------------------------
-- Events
-- ------------------------------------------------------------
drop policy if exists "events staff read" on public.events;
create policy "events staff read" on public.events
  for select using (public.bos_can_access('events'));

drop policy if exists "events staff write" on public.events;
create policy "events staff write" on public.events
  for insert with check (public.bos_can_access('events'));

drop policy if exists "events staff update" on public.events;
create policy "events staff update" on public.events
  for update using (public.bos_can_access('events'))
  with check (public.bos_can_access('events'));

-- Deleting an event orphans its registrations and the money against them, so
-- that stays with the admin policy and is not widened here.

-- ------------------------------------------------------------
-- Registrations: what a ticket count and a door list are made of
-- ------------------------------------------------------------
drop policy if exists "registrations staff read" on public.registrations;
create policy "registrations staff read" on public.registrations
  for select using (public.bos_can_access('events'));

-- Checking somebody in goes through check_in_ticket, which is security
-- definer and does its own permission check, so no update policy is needed.

-- ------------------------------------------------------------
-- The ops overlay follows the same grant
-- ------------------------------------------------------------
drop policy if exists "event ops staff" on public.event_ops;
create policy "event ops staff" on public.event_ops
  for all using (public.bos_can_access('events'))
  with check (public.bos_can_access('events'));

-- ------------------------------------------------------------
-- A slug has to be unique and url-safe, and nobody should have to think
-- about that while typing a title.
-- ------------------------------------------------------------
create or replace function public.bos_event_slug(p_title text, p_id uuid default null)
returns text
language plpgsql
security definer
stable
set search_path = public
as $fn$
declare
  v_base text;
  v_slug text;
  v_n    int := 1;
begin
  v_base := regexp_replace(lower(trim(coalesce(p_title, ''))), '[^a-z0-9]+', '-', 'g');
  v_base := trim(both '-' from v_base);
  if v_base = '' then v_base := 'event'; end if;
  v_slug := v_base;

  while exists (
    select 1 from public.events e
     where e.slug = v_slug and (p_id is null or e.id <> p_id)
  ) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;

  return v_slug;
end;
$fn$;

revoke all on function public.bos_event_slug(text, uuid) from public;
grant execute on function public.bos_event_slug(text, uuid) to authenticated;

-- ------------------------------------------------------------
-- Whoever is on the door
-- ------------------------------------------------------------
-- check_in_ticket admitted an admin or the event host and nobody else, so a
-- member of staff holding the Events section was refused at the door of an
-- event they run. The rest of the function is unchanged.
create or replace function public.check_in_ticket(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
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

  if not (public.is_admin()
          or v_event.host_id = v_uid
          or public.bos_can_access('events')) then
    return jsonb_build_object('status', 'invalid',
      'message', 'Ticket not found — or not for one of your events.');
  end if;

  if v_reg.checked_in_at is not null or v_reg.status = 'attended' then
    return jsonb_build_object('status', 'already', 'message', 'Already checked in',
      'attendeeName', v_reg.attendee_name, 'eventTitle', v_event.title,
      'eventId', v_event.id, 'checkedInAt', v_reg.checked_in_at);
  end if;

  update public.registrations
    set status = 'attended', checked_in_at = now()
    where id = v_reg.id;

  if v_reg.user_id is not null then
    perform public.award_credits(
      v_reg.user_id, 10, 'Attended ' || coalesce(v_event.title, 'an event'), v_reg.event_id);
    perform public.refresh_badges(v_reg.user_id);
  end if;

  perform public.ensure_group_seed_post(v_reg.event_id);

  return jsonb_build_object('status', 'ok', 'message', 'Checked in',
    'attendeeName', v_reg.attendee_name, 'eventTitle', v_event.title,
    'eventId', v_event.id);
end;
$fn$;
