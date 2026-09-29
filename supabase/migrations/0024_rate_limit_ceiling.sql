-- ============================================================
-- The limits in 0023 do not stop the thing they were written for.
--
-- Both triggers key on the address being submitted, so they cap one person
-- submitting repeatedly. A loop does not do that. It uses a different address
-- every time, and every distinct address is a distinct key with an allowance
-- of its own, so the limit never trips. For the newsletter the unique index
-- was doing the visible work, which is what hid it.
--
-- The connection is the right key, and the database cannot see it: PostgREST
-- does not pass the caller address through. So the floor here is a ceiling on
-- the whole table instead, generous enough that real traffic never meets it
-- and low enough that a loop stops in seconds. The per-address limits stay,
-- since they are still the right answer to one person pressing submit again.
--
-- The server action keeps its own limit keyed on the caller address, which is
-- the only layer that can tell two people apart.
--
-- Idempotent. Run AFTER 0023. Safe to run twice.
-- ============================================================

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

  -- Forty an hour across everyone. A company of this size has never seen ten.
  if not public.bos_rate_limit('contact-all', 'global', 40, interval '1 hour') then
    raise exception 'We are getting an unusual number of messages right now. Please try again shortly.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

create or replace function public.bos_guard_newsletter_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not public.bos_rate_limit('newsletter', new.email, 2, interval '1 day') then
    raise exception 'That address has already been subscribed.'
      using errcode = 'check_violation';
  end if;

  -- Thirty an hour across everyone. A launch spike would need a bigger number
  -- than this, and raising it is one line when that day comes.
  if not public.bos_rate_limit('newsletter-all', 'global', 30, interval '1 hour') then
    raise exception 'Too many signups at once. Please try again shortly.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;
