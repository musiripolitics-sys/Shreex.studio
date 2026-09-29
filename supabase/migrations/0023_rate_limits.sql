-- ============================================================
-- Stop the public forms being used in a loop.
--
-- Both forms are anonymous inserts straight from the browser, and since every
-- submission now costs an outbound email, a loop is not just noise: it spends
-- the sending quota and, for the newsletter, mails whoever the address belongs
-- to. A check in the server action alone would be no defence, because the
-- table is reachable over PostgREST without going near it. So the limit lives
-- here, on the table, and the action applies a second one keyed on address.
--
-- Fixed windows rather than a rolling count: one row per bucket per window,
-- which stays cheap and needs no history.
--
-- Idempotent. Safe to run twice.
-- ============================================================

create table if not exists public.rate_limits (
  bucket       text        not null,
  key          text        not null,
  window_start timestamptz not null,
  count        int         not null default 0,
  primary key (bucket, key, window_start)
);

-- Nobody reads this but the functions below; it exists to be counted.
alter table public.rate_limits enable row level security;
drop policy if exists "admin reads rate limits" on public.rate_limits;
create policy "admin reads rate limits" on public.rate_limits
  for select using (public.is_admin());

-- ------------------------------------------------------------
-- Count one hit. True when it is within the allowance.
-- ------------------------------------------------------------
create or replace function public.bos_rate_limit(
  p_bucket  text,
  p_key     text,
  p_limit   int,
  p_window  interval
)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_start timestamptz;
  v_count int;
begin
  if p_key is null or length(trim(p_key)) = 0 then
    return true;      -- nothing to key on; the caller has other defences
  end if;

  -- Truncate now to the window, so every hit in the same window shares a row.
  v_start := to_timestamp(floor(extract(epoch from now()) / extract(epoch from p_window))
                          * extract(epoch from p_window));

  insert into public.rate_limits (bucket, key, window_start, count)
  values (p_bucket, lower(trim(p_key)), v_start, 1)
  on conflict (bucket, key, window_start)
  do update set count = public.rate_limits.count + 1
  returning count into v_count;

  -- Opportunistic cleanup, cheap because it only fires on the first hit of a
  -- window and there is no scheduler here to do it properly.
  if v_count = 1 then
    delete from public.rate_limits where window_start < now() - interval '2 days';
  end if;

  return v_count <= p_limit;
end;
$fn$;

revoke all on function public.bos_rate_limit(text, text, int, interval) from public;
grant execute on function public.bos_rate_limit(text, text, int, interval) to authenticated, anon, service_role;

-- ------------------------------------------------------------
-- The two tables, keyed on the address given
-- ------------------------------------------------------------
create or replace function public.bos_guard_contact_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not public.bos_rate_limit('contact', new.email, 3, interval '1 hour') then
    raise exception 'You have already sent a few messages. Give us a little while to reply.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_bos_guard_contact_rate on public.contact_messages;
create trigger trg_bos_guard_contact_rate
  before insert on public.contact_messages
  for each row execute function public.bos_guard_contact_rate();

create or replace function public.bos_guard_newsletter_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  -- A repeat of the same address is caught by the unique index, so this is
  -- aimed at a loop of different ones.
  if not public.bos_rate_limit('newsletter', new.email, 2, interval '1 day') then
    raise exception 'That address has already been subscribed.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_bos_guard_newsletter_rate on public.newsletter_subscribers;
create trigger trg_bos_guard_newsletter_rate
  before insert on public.newsletter_subscribers
  for each row execute function public.bos_guard_newsletter_rate();
