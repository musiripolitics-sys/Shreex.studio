-- ============================================================
-- A person could write the record of what they were charged.
--
-- The remaining half of the fulfil_order finding. 0043 made a paid order
-- require a paid payment row of at least its total, and said plainly that it
-- raised the bar without closing the door, because of these two policies:
--
--   INSERT  record own payment    with check (auth.uid() = user_id)
--   UPDATE  update own payment    with check (auth.uid() = user_id or is_admin())
--
-- So a signed-in person could insert their own row with status 'paid' and any
-- amount, satisfy the new check, and take the tickets -- and could UPDATE an
-- existing one afterwards, which is worse: the amount recorded against a
-- completed purchase was writable by the purchaser.
--
-- Both are dropped. SELECT stays, because somebody has to be able to see
-- their own receipts.
--
-- ------------------------------------------------------------
-- RUN THIS AFTER the code that moved the payment writes to the service role
-- has deployed.
--
-- The order is safe either way round, unlike 0036: the service role bypasses
-- RLS, so the new code works whether or not this migration has run, and this
-- migration only removes a path the new code no longer uses. If it runs
-- FIRST, the old code fails to log a payment after a verified charge -- which
-- is why the order is stated rather than left to chance.
--
-- The three writers afterwards are all server-side and all verified before
-- they write:
--   api/payments/ticket-verify   signature checked, order priced server-side
--   api/payments/verify          signature checked, price from the plan
--   api/payments/webhook         Razorpay webhook, already the service role
--
-- Idempotent. Run AFTER 0047.
-- ============================================================

drop policy if exists "record own payment" on public.payments;
drop policy if exists "update own payment" on public.payments;

-- Stated explicitly so the intent survives somebody reading only this file.
drop policy if exists "read own payments" on public.payments;
create policy "read own payments" on public.payments
  for select using (auth.uid() = user_id or public.is_admin());

comment on table public.payments is
  $c$Money in. Not writable by a client since 0048: the three writers are the two verification routes and the Razorpay webhook, all server-side and all using the service role after checking a signature. An admin may still correct a row through the admin policy.$c$;
