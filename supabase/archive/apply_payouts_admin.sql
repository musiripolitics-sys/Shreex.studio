-- ============================================================
-- Techxfluence — admin side of host payouts.
--   • get_all_host_earnings() — every host's gross/fee/net/paid/balance
--   • record_payout()         — log a settlement to a host
-- Run once. Idempotent.
-- ============================================================

create or replace function public.get_all_host_earnings()
returns table (
  host_id      uuid,
  host_name    text,
  host_email   text,
  gross        bigint,
  platform_fee bigint,
  net          bigint,
  paid_out     bigint,
  balance      bigint
)
language sql security definer stable set search_path = public as $$
  with gross as (
    select e.host_id, coalesce(sum(p.amount), 0)::bigint as amt
    from public.payments p
    join public.events e on e.id = p.related_id and p.related_type = 'events'
    where p.stream = 'ticket_sales' and p.status = 'paid' and e.host_id is not null
    group by e.host_id
  ),
  paid as (
    select host_id, coalesce(sum(amount), 0)::bigint as amt
    from public.payouts group by host_id
  )
  select u.id,
         u.full_name,
         u.email::text,
         coalesce(g.amt, 0),
         (coalesce(g.amt, 0) / 10),
         (coalesce(g.amt, 0) * 9 / 10),
         coalesce(pd.amt, 0),
         (coalesce(g.amt, 0) * 9 / 10) - coalesce(pd.amt, 0)
  from public.users u
  left join gross g on g.host_id = u.id
  left join paid  pd on pd.host_id = u.id
  where public.is_admin()
    and (g.amt is not null or pd.amt is not null)
  order by ((coalesce(g.amt, 0) * 9 / 10) - coalesce(pd.amt, 0)) desc;
$$;
revoke all on function public.get_all_host_earnings() from public;
grant execute on function public.get_all_host_earnings() to authenticated;

create or replace function public.record_payout(
  p_host_id uuid, p_amount int, p_note text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;

  insert into public.payouts (host_id, amount, note, created_by)
  values (p_host_id, p_amount, p_note, auth.uid())
  returning id into v_id;

  perform public.notify(
    p_host_id, 'payout', 'Payout sent 💸',
    'A payout of ₹' || (p_amount / 100)::text || ' is on its way to you.',
    '/host/dashboard'
  );
  return v_id;
end; $$;
revoke all on function public.record_payout(uuid, int, text) from public;
grant execute on function public.record_payout(uuid, int, text) to authenticated;
