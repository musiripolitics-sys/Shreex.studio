# Database

## Rebuild from scratch
```
schema.sql          -- everything: enums, tables, indexes, functions, triggers, RLS, grants
```
Run `schema.sql` once against a fresh Supabase project. It is idempotent and
ordered by dependency, so it can also be re-run over an existing database.

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
