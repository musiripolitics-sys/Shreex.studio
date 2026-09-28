-- ============================================================
-- Techxfluence Business OS — reviews + approval workflow.
--   • reviews: weekly/monthly retrospective notes (metrics are computed
--     live from tasks/finance; only the qualitative fields persist here).
--   • decide_approval(): admin approve/reject that stamps the decision and
--     notifies the requester (mirrors public.decide_host).
-- Idempotent. Run AFTER 0007 and 0008.
-- ============================================================

create table if not exists public.reviews (
  id                uuid primary key default gen_random_uuid(),
  period_type       text not null check (period_type in ('week','month')),
  period_start      date not null,
  what_worked       text,
  what_failed       text,
  why_text          text,
  corrective_action text,
  next_priority     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (period_type, period_start)
);

drop trigger if exists trg_reviews_updated on public.reviews;
create trigger trg_reviews_updated before update on public.reviews
  for each row execute function public.set_updated_at();

alter table public.reviews enable row level security;
drop policy if exists "admin manage reviews" on public.reviews;
create policy "admin manage reviews" on public.reviews
  for all using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- Approval decision: admin-gated, stamps decision + notifies requester.
-- ------------------------------------------------------------
create or replace function public.decide_approval(
  p_id uuid, p_decision text, p_comments text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare v_a public.approvals;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_decision not in ('approved','rejected','pending') then raise exception 'BAD_DECISION'; end if;

  update public.approvals
     set decision   = p_decision::approval_decision,
         decided_at  = case when p_decision = 'pending' then null else now() end,
         approver_id = auth.uid(),
         comments    = coalesce(nullif(trim(coalesce(p_comments, '')), ''), comments)
   where id = p_id
   returning * into v_a;
  if not found then raise exception 'NOT_FOUND'; end if;

  if v_a.requester_id is not null and p_decision in ('approved','rejected') then
    perform public.notify(
      v_a.requester_id, 'approval',
      'Your ' || v_a.request_type || ' request was ' || p_decision,
      v_a.request_title,
      '/admin/os/approvals'
    );
  end if;
end $$;

grant execute on function public.decide_approval(uuid, text, text) to authenticated;
