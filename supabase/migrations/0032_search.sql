-- ============================================================
-- One search box for the whole OS.
--
-- Thirty-six pages and no way to find a task by name without knowing which
-- page it lives on. This is one query across everything worth finding.
--
-- Deliberately NOT security definer. A plain function runs as whoever called
-- it, so every row-level policy already written applies unchanged: an
-- employee searching finds their own tasks and the blockers they are allowed
-- to see, and somebody without the Money section finds no vendors. Making
-- this security definer would quietly undo all of that in one place.
--
-- Idempotent. Run AFTER 0031.
-- ============================================================

create or replace function public.bos_search(p_q text, p_limit int default 40)
returns table (
  kind     text,
  id       uuid,
  title    text,
  subtitle text,
  href     text,
  rank     int
)
language sql
stable
set search_path = public
as $fn$
with q as (
  select
    nullif(btrim(p_q), '')                     as raw,
    '%' || btrim(p_q) || '%'                   as contains,
    btrim(p_q) || '%'                          as starts
)
select * from (
  -- Rank: 1 an exact code, 2 a title that starts with it, 3 anything else.
  -- Codes are how people refer to work out loud ("where is T-014"), so an
  -- exact one outranks everything.
  select 'Task'::text               as kind,
         t.id                       as id,
         coalesce(t.code || ' ', '') || t.title as title,
         t.status::text             as subtitle,
         '/admin/os/tasks?task=' || t.id        as href,
         case when lower(t.code) = lower((select raw from q)) then 1
              when t.title ilike (select starts from q) then 2 else 3 end as rank
    from public.tasks t, q
   where t.title ilike q.contains or t.code ilike q.contains or t.description ilike q.contains

  union all
  select 'Goal', g.id, coalesce(g.code || ' ', '') || g.objective,
         g.status::text, '/admin/os/roadmap?goal=' || g.id,
         case when lower(g.code) = lower((select raw from q)) then 1
              when g.objective ilike (select starts from q) then 2 else 3 end
    from public.goals g, q
   where g.objective ilike q.contains or g.code ilike q.contains

  union all
  select 'Event', e.id, e.title, coalesce(e.city, '') , '/admin/os/events/' || e.id,
         case when e.title ilike (select starts from q) then 2 else 3 end
    from public.events e, q
   where e.title ilike q.contains or e.city ilike q.contains or e.venue ilike q.contains

  union all
  select 'Content', c.id, coalesce(c.topic, 'Untitled'), coalesce(c.platform, ''),
         '/admin/os/content',
         case when c.topic ilike (select starts from q) then 2 else 3 end
    from public.content_items c, q
   where c.topic ilike q.contains or c.platform ilike q.contains or c.pillar ilike q.contains

  union all
  select 'Campaign', m.id, coalesce(m.code || ' ', '') || m.name,
         coalesce(m.channel, ''), '/admin/os/campaigns',
         case when lower(m.code) = lower((select raw from q)) then 1
              when m.name ilike (select starts from q) then 2 else 3 end
    from public.campaigns m, q
   where m.name ilike q.contains or m.code ilike q.contains or m.objective ilike q.contains

  union all
  select 'Host request', h.id, coalesce(h.title, 'Untitled proposal'),
         coalesce(h.organizer_email, ''), '/admin/os/hosts',
         case when h.title ilike (select starts from q) then 2 else 3 end
    from public.host_submissions h, q
   where h.title ilike q.contains or h.organizer_email ilike q.contains or h.city ilike q.contains

  union all
  select 'Complaint', k.id, coalesce(k.ref || ' ', '') || k.subject,
         k.state::text, '/admin/os/complaints',
         case when lower(k.ref) = lower((select raw from q)) then 1
              when k.subject ilike (select starts from q) then 2 else 3 end
    from public.complaints k, q
   where k.subject ilike q.contains or k.ref ilike q.contains or k.complainant ilike q.contains

  union all
  select 'Risk', r.id, coalesce(r.code || ' ', '') || r.risk,
         coalesce(r.area, ''), '/admin/os/risks',
         case when lower(r.code) = lower((select raw from q)) then 1
              when r.risk ilike (select starts from q) then 2 else 3 end
    from public.risks r, q
   where r.risk ilike q.contains or r.code ilike q.contains or r.area ilike q.contains

  union all
  select 'Procedure', s.id, coalesce(s.code || ' ', '') || s.title,
         s.state::text, '/admin/os/sops',
         case when s.title ilike (select starts from q) then 2 else 3 end
    from public.sop_documents s, q
   where s.title ilike q.contains or s.code ilike q.contains or s.purpose ilike q.contains

  union all
  select 'Vendor', v.id, v.name, coalesce(v.category, ''), '/admin/os/vendors',
         case when v.name ilike (select starts from q) then 2 else 3 end
    from public.vendors v, q
   where v.name ilike q.contains or v.category ilike q.contains or v.service ilike q.contains

  union all
  select 'Competitor', w.id, w.name, coalesce(w.category, ''), '/admin/os/competitors',
         case when w.name ilike (select starts from q) then 2 else 3 end
    from public.competitors w, q
   where w.name ilike q.contains or w.category ilike q.contains or w.offer ilike q.contains

  union all
  select 'Episode', p.id, p.title, coalesce(p.guest, ''), '/admin/os/podcast',
         case when p.title ilike (select starts from q) then 2 else 3 end
    from public.podcast_episodes p, q
   where p.title ilike q.contains or p.guest ilike q.contains or p.topic ilike q.contains

  union all
  select 'Module', a.id, a.module, coalesce(a.feature, ''), '/admin/os/product',
         case when a.module ilike (select starts from q) then 2 else 3 end
    from public.app_modules a, q
   where a.module ilike q.contains or a.feature ilike q.contains

  union all
  select 'Role', n.id, n.role, coalesce(n.department, ''), '/admin/os/hiring',
         case when n.role ilike (select starts from q) then 2 else 3 end
    from public.hiring_plan n, q
   where n.role ilike q.contains or n.department ilike q.contains

  union all
  select 'Legal', l.id, l.requirement, l.status::text, '/admin/os/legal',
         case when l.requirement ilike (select starts from q) then 2 else 3 end
    from public.legal_items l, q
   where l.requirement ilike q.contains

  union all
  select 'Person', u.id, coalesce(u.full_name, u.email), coalesce(u.primary_role::text, ''),
         '/admin/os/people',
         case when u.full_name ilike (select starts from q) then 2 else 3 end
    from public.users u, q
   where u.primary_role::text in ('admin', 'employee', 'event_host')
     and (u.full_name ilike q.contains or u.email ilike q.contains)
) hits
-- A blank box searches for nothing rather than returning the whole database.
where (select raw from q) is not null
order by hits.rank, hits.kind, hits.title
limit greatest(1, least(p_limit, 100));
$fn$;

revoke all on function public.bos_search(text, int) from public;
grant execute on function public.bos_search(text, int) to authenticated;
