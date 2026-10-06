-- ============================================================
-- A rejected tenant claim denies, instead of falling back.
--
-- Found by the Stage 5 role tests, not by reading the code. The assertion
-- was that an admin of one business asking for another by claim is not an
-- admin there. It failed, and the reason was two functions each behaving
-- correctly on its own:
--
--   bos_current_tenant  sees a claim for a tenant the caller does not belong
--                       to and returns null, which is right.
--   bos_request_tenant  sees that null and falls back to the default tenant,
--                       which is right for an ANONYMOUS caller and wrong here.
--
-- Together they turn "you may not act in that business" into "very well, act
-- in the default one". For a member of the default tenant that reads as the
-- claim being ignored; for anyone else it silently moves them somewhere they
-- have no membership. Neither is a data leak -- the restrictive policies and
-- the role predicates still apply wherever they land -- but a request scoped
-- to one business should not be answered as though it named another.
--
-- The fix is to distinguish NO CLAIM from REJECTED CLAIM. The fallbacks exist
-- for the first case only.
--
-- Idempotent. Run AFTER 0040.
-- ============================================================

-- The raw claim, or null. Not SECURITY DEFINER: reading a session setting
-- needs no privilege, and the fewer definer functions exist the less there is
-- for a later stage to audit.
create or replace function public.bos_claimed_tenant()
returns uuid
language plpgsql
stable
set search_path = public
as $fn$
declare v uuid;
begin
  -- Read from the token rather than a session variable the client could set,
  -- because a parameter the client sets is a parameter the client can change.
  begin
    v := nullif(current_setting('request.jwt.claim.tenant_id', true), '')::uuid;
  exception when others then v := null;
  end;
  if v is null then
    begin
      v := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id', '')::uuid;
    exception when others then v := null;
    end;
  end if;
  return v;
end $fn$;

comment on function public.bos_claimed_tenant() is
  $c$The tenant_id claim carried by the token, or null when there is none. Says nothing about whether the caller may act in it.$c$;

create or replace function public.bos_current_tenant()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_claim uuid := public.bos_claimed_tenant();
  v       uuid;
begin
  if v_claim is not null then
    -- The token says which tenant; membership says whether that is allowed.
    if exists (select 1 from public.tenant_members m
                where m.tenant_id = v_claim
                  and m.user_id = auth.uid()
                  and m.status = 'active')
    then
      return v_claim;
    end if;
    return null;
  end if;

  select m.tenant_id into v
    from public.tenant_members m
   where m.user_id = auth.uid() and m.status = 'active'
   order by m.joined_at, m.id
   limit 1;
  return v;
end $fn$;

create or replace function public.bos_request_tenant()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare v uuid;
begin
  -- A claim that was present and refused means no tenant, not the default
  -- one. Falling back here is what let a refused claim land the caller in
  -- the default tenant.
  if public.bos_claimed_tenant() is not null then
    return public.bos_current_tenant();
  end if;

  v := public.bos_current_tenant();
  if v is not null then return v; end if;

  -- No claim and no membership: an anonymous visitor on the public site, or
  -- a trigger running outside a request. A restrictive policy comparing
  -- tenant_id against NULL would hide every row from everybody.
  select id into v from public.tenants where is_default;
  if v is not null then return v; end if;

  if (select count(*) from public.tenants where status = 'active') = 1 then
    select id into v from public.tenants where status = 'active';
  end if;
  return v;
end $fn$;

comment on function public.bos_request_tenant() is
  $c$The tenant this request belongs to. With a claim: that tenant if the caller is an active member of it, otherwise NOTHING. Without a claim: the caller own membership, else the default tenant, else the only tenant if there is exactly one.$c$;

revoke all on function public.bos_claimed_tenant() from public;
grant execute on function public.bos_claimed_tenant() to authenticated, anon, service_role;
