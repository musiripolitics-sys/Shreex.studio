-- ============================================================
-- Record the emails that do not arrive.
--
-- src/lib/email.ts has written every delivery failure to this table since it
-- was added, and the admin console reads it to raise a banner. The table was
-- only ever declared in schema.sql, which this database never had run against
-- it, so the insert has been failing into its own catch block and every failed
-- send has vanished.
--
-- That matters right now: SMTP is refusing with 535, so every task email the
-- OS tries to send is being dropped with no record of it anywhere.
--
-- Idempotent. Safe to run twice.
-- ============================================================

create table if not exists public.email_failures (
  id         uuid primary key default gen_random_uuid(),
  recipient  text not null,
  subject    text,
  error      text,
  created_at timestamptz not null default now()
);

create index if not exists email_failures_recent_idx
  on public.email_failures(created_at desc);

alter table public.email_failures enable row level security;

-- Recipients and error text are operational detail, so admins only. The
-- inserts come from the service role, which is not subject to this.
drop policy if exists "admin reads email failures" on public.email_failures;
create policy "admin reads email failures" on public.email_failures
  for select using (public.is_admin());
