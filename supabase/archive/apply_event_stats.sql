-- ============================================================
-- Techxfluence — per-event analytics for the organiser.
-- Host-or-admin gated: a host only ever sees their own events.
-- Run once. Idempotent.
-- ============================================================
create or replace function public.get_event_stats(p_event_id uuid)
returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare v_ev public.events;
begin
  select * into v_ev from public.events where id = p_event_id;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  if not (public.is_admin() or v_ev.host_id = auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;

  return jsonb_build_object(
    'revenue', (
      select coalesce(sum(p.amount), 0) from public.payments p
      where p.related_type = 'events' and p.related_id = p_event_id and p.status = 'paid'
    ),
    'tickets', (
      select count(*) from public.registrations r
      where r.event_id = p_event_id and r.status in ('registered', 'attended')
    ),
    'checked_in', (
      select count(*) from public.registrations r
      where r.event_id = p_event_id and r.status = 'attended'
    ),
    'waitlisted', (
      select count(*) from public.registrations r
      where r.event_id = p_event_id and r.status = 'waitlisted'
    ),
    'last7', (
      select count(*) from public.registrations r
      where r.event_id = p_event_id and r.registered_at > now() - interval '7 days'
    ),
    'tiers', (
      select coalesce(
        jsonb_agg(jsonb_build_object(
          'name', t.name, 'sold', t.sold, 'capacity', t.capacity, 'price', t.price_amount
        ) order by t.sort_order), '[]'::jsonb)
      from public.ticket_types t where t.event_id = p_event_id
    )
  );
end; $$;
revoke all on function public.get_event_stats(uuid) from public;
grant execute on function public.get_event_stats(uuid) to authenticated;
