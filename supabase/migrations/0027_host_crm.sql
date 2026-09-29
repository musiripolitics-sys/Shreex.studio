-- ============================================================
-- Phase 3: host requests become a pipeline with a conversation attached.
--
-- A proposal arrived in host_submissions and sat there. Whatever happened
-- next happened in somebody's personal inbox, so nobody else could see what
-- had been said, what was agreed, or whether anyone had replied at all. The
-- status column had two useful values and no idea of progress.
--
-- Three things are added: a stage, a thread, and a template library. Stages
-- are deliberately few — a pipeline nobody updates tells you nothing, and
-- seven columns is where people stop updating.
--
-- Idempotent. Run AFTER 0026.
-- ============================================================

do $mig$ begin
  create type public.host_stage as enum
    ('new', 'qualifying', 'proposed', 'scheduled', 'running', 'done', 'declined');
exception when duplicate_object then null; end $mig$;

alter table public.host_submissions
  add column if not exists stage        public.host_stage not null default 'new',
  add column if not exists owner_id     uuid references public.users(id) on delete set null,
  add column if not exists event_id     uuid references public.events(id) on delete set null,
  add column if not exists next_step    text,
  add column if not exists next_step_on date,
  add column if not exists stage_changed_at timestamptz not null default now();

create index if not exists idx_host_submissions_stage on public.host_submissions(stage);

-- Anything already reviewed is not sitting in the new column.
update public.host_submissions
   set stage = case
         when status::text = 'approved' then 'scheduled'::public.host_stage
         when status::text = 'rejected' then 'declined'::public.host_stage
         else 'new'::public.host_stage
       end
 where stage = 'new' and status::text in ('approved', 'rejected');

-- Keep the clock honest without the pages having to remember to set it.
create or replace function public.bos_stamp_host_stage()
returns trigger language plpgsql set search_path = public as $fn$
begin
  if new.stage is distinct from old.stage then
    new.stage_changed_at := now();
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_bos_stamp_host_stage on public.host_submissions;
create trigger trg_bos_stamp_host_stage
  before update on public.host_submissions
  for each row execute function public.bos_stamp_host_stage();

-- ------------------------------------------------------------
-- The conversation
-- ------------------------------------------------------------
create table if not exists public.host_messages (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.host_submissions(id) on delete cascade,
  author_id     uuid references public.users(id) on delete set null,
  kind          text not null default 'note',   -- note | email | stage | call
  subject       text,
  body          text not null,
  to_email      text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_host_messages_submission
  on public.host_messages(submission_id, created_at);

alter table public.host_messages enable row level security;

drop policy if exists "host messages staff" on public.host_messages;
create policy "host messages staff" on public.host_messages
  for all using (public.bos_can_access('events'))
  with check (public.bos_can_access('events'));

-- ------------------------------------------------------------
-- What we usually say
-- ------------------------------------------------------------
create table if not exists public.email_templates (
  id          uuid primary key default gen_random_uuid(),
  key         text unique,
  name        text not null,
  purpose     text,
  subject     text not null,
  body        text not null,
  stage       public.host_stage,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.email_templates enable row level security;

drop policy if exists "templates staff read" on public.email_templates;
create policy "templates staff read" on public.email_templates
  for select using (public.bos_is_staff());

drop policy if exists "templates admin manage" on public.email_templates;
create policy "templates admin manage" on public.email_templates
  for all using (public.is_admin()) with check (public.is_admin());

-- Starting templates. Every one is editable before it is sent, and the
-- placeholders are filled from the submission.
insert into public.email_templates (key, name, purpose, subject, body, stage, sort_order)
values
  ('host-ack', 'Acknowledge the proposal',
   'First reply, within a day of the form arriving.',
   'About your event proposal, {{event}}',
   E'Hi {{name}},\n\nThanks for proposing {{event}} — it landed with us and I have read it.\n\nI would like to understand a little more before we take it further: who you expect in the room, what you need from us, and whether {{date}} is firm.\n\nCould we find twenty minutes this week?\n\nBest,\n{{sender}}\nTechxfluence',
   'qualifying', 10),

  ('host-questions', 'Ask the qualifying questions',
   'When the proposal is interesting but thin.',
   'A few questions about {{event}}',
   E'Hi {{name}},\n\n{{event}} looks like a good fit. Before we commit a date, four things:\n\n1. How many people are you expecting, and where are they coming from?\n2. What do you need from us — venue, promotion, speakers, all three?\n3. Is {{date}} firm, or is there room to move it?\n4. Is anyone else involved in running it?\n\nOnce I have those I can tell you quickly whether we can take it on.\n\nBest,\n{{sender}}\nTechxfluence',
   'qualifying', 20),

  ('host-proposal', 'Send the proposal',
   'What we will do, what we need, what it costs.',
   'Our proposal for {{event}}',
   E'Hi {{name}},\n\nHere is what we are proposing for {{event}} on {{date}} in {{city}}.\n\nWhat we would do:\n- Venue and set-up\n- Promotion through our channels and mailing list\n- Registration, ticketing and check-in on the day\n\nWhat we would need from you:\n- The agenda and speakers confirmed two weeks out\n- Someone on site from an hour before\n\nIf that reads right, say so and I will put the date in and open registration.\n\nBest,\n{{sender}}\nTechxfluence',
   'proposed', 30),

  ('host-confirmed', 'Confirm the date',
   'Once it is agreed and going in the calendar.',
   'Confirmed: {{event}} on {{date}}',
   E'Hi {{name}},\n\n{{event}} is confirmed for {{date}} in {{city}}. I am setting the page up now and will send you the link once registration is open.\n\nBetween now and then I need the agenda and the speaker list. Anything else you are waiting on from me, just ask.\n\nLooking forward to it.\n\nBest,\n{{sender}}\nTechxfluence',
   'scheduled', 40),

  ('host-decline', 'Decline, kindly',
   'When it is not a fit. Say why, and leave the door open.',
   'About {{event}}',
   E'Hi {{name}},\n\nThanks for thinking of us for {{event}}. We are not going to be able to take this one on — our calendar for that period is already committed and I would rather say so now than keep you waiting.\n\nIt is a genuine no to the timing rather than to the idea. If you want to come back to us for a later date, please do.\n\nBest,\n{{sender}}\nTechxfluence',
   'declined', 50),

  ('host-thanks', 'Thank them afterwards',
   'After the event, with the numbers.',
   'Thank you for {{event}}',
   E'Hi {{name}},\n\nThank you for {{event}} — it went well and the feedback has been good.\n\nI will send the attendance and registration numbers separately. If you would like to do another, we should talk about dates while this one is fresh.\n\nBest,\n{{sender}}\nTechxfluence',
   'done', 60)
on conflict (key) do nothing;
