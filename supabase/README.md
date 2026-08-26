# Database

## Rebuild from scratch
```
schema.sql          -- everything: enums, tables, indexes, functions, triggers, RLS, grants
```
Run `schema.sql` once against a fresh Supabase project. It is idempotent and
ordered by dependency, so it can also be re-run over an existing database.

## If schema.sql fails with a syntax error
Postgres parses an entire multi-statement script *before* executing any of it,
so a single syntax error anywhere aborts the whole run — and the line it
reports is where the error is, not where it gave up.

`parts/` holds the same schema split at statement boundaries. Run
`parts/01.sql` … `parts/06.sql` in order in the Supabase SQL editor; whichever
part fails narrows the problem from 2 200 lines to a couple of hundred. Each
part is idempotent, and applying all six is equivalent to running `schema.sql`
once (verified: same 38 tables, 83 policies).

Note the Postgres version when reporting a failure — this schema is verified
against PostgreSQL 18, and Supabase projects commonly run 15 or 17.

## Community credits — one-time setup
The community section of `schema.sql` adds credits, gates and paid downloads.
To turn it on:

1. **Re-run `schema.sql`.** It's idempotent, so this is safe over the live
   database. It creates `community_gates`, `community_files`, `file_unlocks`,
   backfills `point_events` from balances members already hold, and starts
   gating posts.
2. **Create a private storage bucket named `community`** (Supabase → Storage →
   New bucket, *not* public). Downloads are served as 60-second signed URLs
   minted only after `unlock_file()` confirms payment; a public bucket would
   make the credit gate decoration.

Until step 1 runs, the app degrades quietly: gates read as 0, so nothing is
blocked, and the downloads shelf stays empty.

### Tuning the gates
Thresholds are rows, not code:
```sql
-- Require 3 sessions' worth of credits to post in public channels
update community_gates set min_balance = 30 where action = 'post_global';

-- Charge per post instead of gating on balance held
update community_gates set min_balance = 0, cost = 5 where action = 'post_group';
```

## Event discovery — one-time setup
Re-running `schema.sql` also adds `events.tags`, `latitude`/`longitude`,
`highlights` and `refund_policy`. All are defaulted, so existing events stay
valid and the pages degrade cleanly until it runs:

| Missing | Behaviour |
|---|---|
| `tags` | No tag filter, no tag chips |
| `latitude`/`longitude` | Address with Google/Apple Maps links instead of a map |
| `highlights` | "Good to know" doesn't render |
| `refund_policy` | Refunds section doesn't render |

The event queries select these columns separately and retry without them on
error, so a pending migration can't drop the events page to static seed data.

## Chapters — one-time setup
Re-running `schema.sql` adds `communities`, `community_members`, and the
`community_id` columns on events and posts. Chapters are created from the
admin console; until at least one exists, `/communities` shows an empty state
and everything else is unchanged.

Seed a first chapter directly if you prefer:
```sql
insert into communities (slug, name, kind, city, tagline, created_by)
values ('chennai', 'Techxfluence Chennai', 'city', 'Chennai',
        'Where Chennai builds.', (select id from users where email = 'you@…'));

-- Make yourself its organiser
insert into community_members (community_id, user_id, role)
select c.id, u.id, 'organizer' from communities c, users u
 where c.slug = 'chennai' and u.email = 'you@…';

-- Attach existing events to it by city
update events set community_id = (select id from communities where slug='chennai')
 where city = 'Chennai' and community_id is null;
```

## Email
```
npm run check:smtp                 # verify credentials, send nothing
npm run check:smtp you@example.com # also send one test message
npm run test:email                 # all 9 templates through a local SMTP sink
```
`test:email` needs no credentials and no network — it stands up a local SMTP
server, sends every template through the real code path, and checks what came
out: subject present, correct From, HTML body, and no undefined leaking from a
renamed field.
Prints the exact SMTP response, so a rejected password can be told apart from
a network problem. Never prints the password itself.

Sends are best-effort and never break a registration, but failures are now
recorded in `email_failures` and the admin console shows a banner when any
occurred in the last 7 days.

**Google Workspace notes.** `SMTP_PASS` must be a 16-character App Password,
not the account password, and the account needs 2-Step Verification on. App
Passwords are revoked whenever the account password changes. An alias or
Google Group cannot authenticate at all — authenticate as a real mailbox and
keep the alias in `EMAIL_FROM`, with the alias added under Gmail →
Settings → Accounts → "Send mail as".

## Tests
```
for t in credits reports group-seed; do node supabase/tests/$t.test.mjs; done
```
Each runs `schema.sql` on a real Postgres (PGlite, in-memory) and asserts
behaviour, not shape:

| Suite | Covers |
|---|---|
| `credits` | Spending can't go negative, downloads charge once, gates threshold correctly, the backfill is idempotent |
| `reports` | Admins are notified once per report, duplicates are refused, only admins resolve |
| `group-seed` | First check-in leaves a pinned welcome post; later check-ins don't duplicate it |

## Seeds (optional, run after schema.sql)
| File | Purpose |
|---|---|
| `seed_content.sql` | Leaders, plan perks |
| `seed_events.sql` | Sample events + speakers |
| `seed_test_users.sql` | member@ / host@ / admin@txf.test — password `Password123!` |
| `reset_test_users.sql` | Re-run when those accounts already exist |

## Utilities
| File | Purpose |
|---|---|
| `cleanup_test_data.sql` | Remove seeded test events/submissions |
| `reset_events_ai_online.sql` | Wipe events, seed one online AI event |

## archive/
The 23 incremental `apply_*.sql` patches this schema was consolidated from,
kept for history. **Do not run them** — `schema.sql` supersedes all of them,
and several redefine the same function (replaying them out of order caused a
duplicate-overload outage once already).
