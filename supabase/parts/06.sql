-- schema.sql part 6 of 6
-- Source lines 2113-2237 of supabase/schema.sql.
-- Run the parts in order. Each is idempotent, like the whole file.

grant execute on function public.register_for_event(uuid, text, text, text, uuid, uuid)
  to anon, authenticated, service_role;

revoke all on function public.join_waitlist(uuid, text, text, text) from public;

grant execute on function public.join_waitlist(uuid, text, text, text) to anon, authenticated;

revoke all on function public.cancel_registration(uuid) from public;

grant execute on function public.cancel_registration(uuid) to authenticated;

revoke all on function public.get_directory() from public;

grant execute on function public.get_directory() to authenticated;

revoke all on function public.check_in_ticket(text) from public;

grant execute on function public.check_in_ticket(text) to authenticated;

grant execute on function public.attended(uuid) to authenticated;

revoke all on function public.notify(uuid, text, text, text, text) from public;

revoke all on function public.decide_host(uuid, boolean) from public;

grant execute on function public.decide_host(uuid, boolean) to authenticated;

grant execute on function public.validate_promo(text) to anon, authenticated;

revoke all on function public.redeem_promo(text) from public;

grant execute on function public.redeem_promo(text) to authenticated, service_role;

grant execute on function public.get_host_earnings() to authenticated;

grant execute on function public.record_sponsorship(int, text) to authenticated;

grant execute on function public.get_top_members(int) to anon, authenticated;

grant execute on function public.member_discount_pct(uuid) to authenticated, service_role;

revoke all on function public.create_pending_order(uuid, uuid, int, text, text, text, text, uuid, jsonb) from public;

grant execute on function public.create_pending_order(uuid, uuid, int, text, text, text, text, uuid, jsonb)
  to anon, authenticated, service_role;

revoke all on function public.fulfil_order(uuid, uuid) from public;

grant execute on function public.fulfil_order(uuid, uuid) to authenticated, service_role;

revoke all on function public.register_free_order(uuid, uuid, int, text, text, text, jsonb) from public;

grant execute on function public.register_free_order(uuid, uuid, int, text, text, text, jsonb)
  to anon, authenticated, service_role;

revoke all on function public.expire_pending_orders() from public;

grant execute on function public.expire_pending_orders() to authenticated, service_role;

revoke all on function public.get_all_host_earnings() from public;

grant execute on function public.get_all_host_earnings() to authenticated;

revoke all on function public.record_payout(uuid, int, text) from public;

grant execute on function public.record_payout(uuid, int, text) to authenticated;

revoke all on function public.get_event_stats(uuid) from public;

grant execute on function public.get_event_stats(uuid) to authenticated;

grant execute on function public.get_organizer(uuid) to anon, authenticated;

revoke all on function public.notify_followers(uuid) from public;

grant execute on function public.notify_followers(uuid) to authenticated;

-- ---------- RLS ----------
alter table public.community_gates enable row level security;
alter table public.community_files enable row level security;
alter table public.file_unlocks    enable row level security;
alter table public.point_events    enable row level security;

drop policy if exists "read gates" on public.community_gates;
create policy "read gates" on public.community_gates
  for select using (auth.uid() is not null);

drop policy if exists "admin writes gates" on public.community_gates;
create policy "admin writes gates" on public.community_gates
  for all using (public.is_admin()) with check (public.is_admin());

-- Files follow the same visibility rule as posts.
drop policy if exists "read community files" on public.community_files;
create policy "read community files" on public.community_files
  for select using (
    auth.uid() is not null
    and (event_id is null or public.is_admin() or public.attended(event_id))
  );

drop policy if exists "admin writes files" on public.community_files;
create policy "admin writes files" on public.community_files
  for all using (public.is_admin()) with check (public.is_admin());

-- Members see only their own unlocks; only unlock_file() creates them.
drop policy if exists "read own unlocks" on public.file_unlocks;
create policy "read own unlocks" on public.file_unlocks
  for select using (auth.uid() = user_id or public.is_admin());

-- Members read their own credit history.
drop policy if exists "read own point events" on public.point_events;
create policy "read own point events" on public.point_events
  for select using (auth.uid() = user_id or public.is_admin());

-- ---------- Grants ----------
revoke all on function public.award_credits(uuid, int, text, uuid) from public;

revoke all on function public.spend_credits(int, text, uuid) from public;
grant execute on function public.spend_credits(int, text, uuid) to authenticated;

grant execute on function public.meets_gate(text) to authenticated;

revoke all on function public.unlock_file(uuid) from public;
grant execute on function public.unlock_file(uuid) to authenticated;
