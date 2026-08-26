-- schema.sql part 5 of 6
-- Source lines 1869-2112 of supabase/schema.sql.
-- Run the parts in order. Each is idempotent, like the whole file.

drop policy if exists "admin manage leaders" on public.leader_profiles;
create policy "admin manage leaders"        on public.leader_profiles   for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin manage contact" on public.contact_messages;
create policy "admin manage contact"        on public.contact_messages  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin manage newsletter" on public.newsletter_subscribers;
create policy "admin manage newsletter"     on public.newsletter_subscribers for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin manage registrations" on public.registrations;
create policy "admin manage registrations"  on public.registrations     for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin manage payments" on public.payments;
create policy "admin manage payments"       on public.payments          for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin manage sponsorships" on public.sponsorships;
create policy "admin manage sponsorships"   on public.sponsorships      for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "read own roles" on public.user_roles;
create policy "read own roles" on public.user_roles
  for select using (auth.uid() = user_id or public.is_admin());

drop policy if exists "admin manage roles" on public.user_roles;
create policy "admin manage roles" on public.user_roles
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin update users" on public.users;
create policy "admin update users" on public.users
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "host read own submissions" on public.host_submissions;
create policy "host read own submissions" on public.host_submissions
  for select using (organizer_id = auth.uid());

drop policy if exists "host resubmit declined" on public.host_submissions;
create policy "host resubmit declined" on public.host_submissions
  for update using (organizer_id = auth.uid() and status = 'declined')
  with check (organizer_id = auth.uid());

drop policy if exists "host read own events" on public.events;
create policy "host read own events" on public.events
  for select using (host_id = auth.uid());

drop policy if exists "host read event registrations" on public.registrations;
create policy "host read event registrations" on public.registrations
  for select using (
    exists (select 1 from public.events e
            where e.id = registrations.event_id and e.host_id = auth.uid())
  );

drop policy if exists "host manage event registrations" on public.registrations;
create policy "host manage event registrations" on public.registrations
  for update using (
    exists (select 1 from public.events e
            where e.id = registrations.event_id and e.host_id = auth.uid())
  );

drop policy if exists "read posts" on public.posts;
create policy "read posts" on public.posts for select using (
  auth.uid() is not null
  and (event_id is null or public.is_admin() or public.attended(event_id))
);

drop policy if exists "create own post" on public.posts;
create policy "create own post" on public.posts for insert with check (
  auth.uid() = author_id
  and (event_id is null or public.is_admin() or public.attended(event_id))
  -- Credit gate: holding a balance, not spending it. Admins are exempt.
  and public.meets_gate(case when event_id is null then 'post_global' else 'post_group' end)
);

drop policy if exists "admin update posts" on public.posts;
create policy "admin update posts" on public.posts
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "delete own or admin" on public.posts;
create policy "delete own or admin" on public.posts
  for delete using (auth.uid() = author_id or public.is_admin());

drop policy if exists "read reactions" on public.post_reactions;
create policy "read reactions" on public.post_reactions for select using (
  exists (
    select 1 from public.posts p
    where p.id = post_reactions.post_id
      and (p.event_id is null or public.is_admin() or public.attended(p.event_id))
  )
);

drop policy if exists "like own" on public.post_reactions;
create policy "like own" on public.post_reactions for insert with check (
  auth.uid() = user_id and exists (
    select 1 from public.posts p
    where p.id = post_reactions.post_id
      and (p.event_id is null or public.is_admin() or public.attended(p.event_id))
  )
);

drop policy if exists "unlike own" on public.post_reactions;
create policy "unlike own" on public.post_reactions
  for delete using (auth.uid() = user_id);

drop policy if exists "read comments" on public.post_comments;
create policy "read comments" on public.post_comments for select using (
  exists (
    select 1 from public.posts p
    where p.id = post_comments.post_id
      and (p.event_id is null or public.is_admin() or public.attended(p.event_id))
  )
);

drop policy if exists "comment own" on public.post_comments;
create policy "comment own" on public.post_comments for insert with check (
  auth.uid() = author_id
  and public.meets_gate('comment')
  and exists (
    select 1 from public.posts p
    where p.id = post_comments.post_id
      and (p.event_id is null or public.is_admin() or public.attended(p.event_id))
  )
);

drop policy if exists "delete own comment or admin" on public.post_comments;
create policy "delete own comment or admin" on public.post_comments
  for delete using (auth.uid() = author_id or public.is_admin());

drop policy if exists "read own notifications" on public.notifications;
create policy "read own notifications" on public.notifications
  for select using (auth.uid() = user_id);

drop policy if exists "update own notifications" on public.notifications;
create policy "update own notifications" on public.notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "insert own notifications" on public.notifications;
create policy "insert own notifications" on public.notifications
  for insert with check (auth.uid() = user_id);

drop policy if exists "admin manage promos" on public.promo_codes;
create policy "admin manage promos" on public.promo_codes
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "host read own payouts" on public.payouts;
create policy "host read own payouts" on public.payouts
  for select using (auth.uid() = host_id or public.is_admin());

drop policy if exists "admin manage payouts" on public.payouts;
create policy "admin manage payouts" on public.payouts
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "read ticket types" on public.ticket_types;
create policy "read ticket types" on public.ticket_types
  for select using (
    is_hidden = false
    and exists (select 1 from public.events e
                where e.id = ticket_types.event_id and e.status = 'published')
  );

drop policy if exists "admin manage ticket types" on public.ticket_types;
create policy "admin manage ticket types" on public.ticket_types
  for all using (
    public.is_admin()
    or exists (select 1 from public.events e
               where e.id = ticket_types.event_id and e.host_id = auth.uid())
  ) with check (
    public.is_admin()
    or exists (select 1 from public.events e
               where e.id = ticket_types.event_id and e.host_id = auth.uid())
  );

drop policy if exists "read own orders" on public.orders;
create policy "read own orders" on public.orders
  for select using (
    auth.uid() = user_id
    or public.is_admin()
    or exists (select 1 from public.events e
               where e.id = orders.event_id and e.host_id = auth.uid())
  );

drop policy if exists "host update own events" on public.events;
create policy "host update own events" on public.events
  for update
  using (host_id = auth.uid())
  with check (host_id = auth.uid());

drop policy if exists "read event questions" on public.event_questions;
create policy "read event questions" on public.event_questions
  for select using (
    exists (select 1 from public.events e
            where e.id = event_questions.event_id and e.status = 'published')
  );

drop policy if exists "manage event questions" on public.event_questions;
create policy "manage event questions" on public.event_questions
  for all using (
    public.is_admin()
    or exists (select 1 from public.events e
               where e.id = event_questions.event_id and e.host_id = auth.uid())
  ) with check (
    public.is_admin()
    or exists (select 1 from public.events e
               where e.id = event_questions.event_id and e.host_id = auth.uid())
  );

drop policy if exists "host create own events" on public.events;
create policy "host create own events" on public.events
  for insert
  with check (host_id = auth.uid() and public.is_host());

drop policy if exists "host delete own events" on public.events;
create policy "host delete own events" on public.events
  for delete
  using (host_id = auth.uid());

drop policy if exists "read own saved" on public.saved_events;
create policy "read own saved" on public.saved_events
  for select using (auth.uid() = user_id);

drop policy if exists "save own" on public.saved_events;
create policy "save own" on public.saved_events
  for insert with check (auth.uid() = user_id);

drop policy if exists "unsave own" on public.saved_events;
create policy "unsave own" on public.saved_events
  for delete using (auth.uid() = user_id);

drop policy if exists "read own follows" on public.organizer_follows;
create policy "read own follows" on public.organizer_follows
  for select using (auth.uid() = follower_id or auth.uid() = organizer_id);

drop policy if exists "follow own" on public.organizer_follows;
create policy "follow own" on public.organizer_follows
  for insert with check (auth.uid() = follower_id);

drop policy if exists "unfollow own" on public.organizer_follows;
create policy "unfollow own" on public.organizer_follows
  for delete using (auth.uid() = follower_id);


-- ============================================================
-- Grants
-- ============================================================

revoke all on function public.register_for_event(uuid, text, text, text, uuid, uuid) from public;
