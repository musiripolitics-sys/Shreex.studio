-- ============================================================
-- Bring the existing SOPs into the system that replaced their page.
--
-- 0028 gave procedures versions, approvals, acknowledgements and runs, and
-- the nav item now opens that. What it did not do is carry anything over, so
-- the six rows already in the old sops table — a complete six-step Event
-- delivery procedure somebody wrote — stopped being reachable from the
-- interface entirely. The data was never at risk; it simply had no page.
--
-- Each distinct process becomes one document with one approved version, and
-- each of its rows becomes a step in the order it was written. The old table
-- is left exactly as it is: nothing is deleted, and running this twice adds
-- nothing, so it can be re-run without thought.
--
-- Idempotent. Run AFTER 0030.
-- ============================================================

do $mig$
declare
  proc     record;
  stp      record;
  v_doc    uuid;
  v_ver    uuid;
  v_owner  uuid;
  v_n      int;
begin
  -- Nothing to do where the old table never existed or is empty.
  if to_regclass('public.sops') is null then return; end if;

  for proc in
    select process,
           -- There is no min() for a uuid, and any owner on the process will
           -- do: they were all written by the same hand.
           (array_agg(owner_id) filter (where owner_id is not null))[1] as owner_id,
           min(last_reviewed) as last_reviewed,
           min(next_review)   as next_review
      from public.sops
     where coalesce(trim(process), '') <> ''
     group by process
  loop
    -- Already carried over on an earlier run.
    if exists (select 1 from public.sop_documents d where d.title = proc.process) then
      continue;
    end if;

    v_owner := proc.owner_id;

    insert into public.sop_documents (title, purpose, category, owner_id, state, next_review)
    values (
      proc.process,
      'Carried over from the original SOP register.',
      'Events',
      v_owner,
      'published',
      proc.next_review
    )
    returning id into v_doc;

    -- These were in use before this system existed, so they arrive approved
    -- rather than as a draft nobody has signed off.
    insert into public.sop_versions (sop_id, version, body, change_note, author_id, approved_by, approved_at)
    values (
      v_doc, 1,
      'Carried over from the original SOP register, unchanged.',
      'Initial import',
      v_owner, v_owner, coalesce(proc.last_reviewed::timestamptz, now())
    )
    returning id into v_ver;

    v_n := 0;
    for stp in
      select step, quality_check, pass_criteria, evidence_url
        from public.sops
       where process = proc.process
       order by step
    loop
      v_n := v_n + 1;
      insert into public.sop_steps (version_id, sort_order, instruction, pass_criteria, needs_evidence)
      values (
        v_ver,
        v_n,
        coalesce(nullif(trim(stp.step), ''), 'Step ' || v_n),
        coalesce(nullif(trim(stp.pass_criteria), ''), nullif(trim(stp.quality_check), '')),
        stp.evidence_url is not null
      );
    end loop;
  end loop;
end $mig$;
