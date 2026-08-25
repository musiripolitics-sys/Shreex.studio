# Database

## Rebuild from scratch
```
schema.sql          -- everything: enums, tables, indexes, functions, triggers, RLS, grants
```
Run `schema.sql` once against a fresh Supabase project. It is idempotent and
ordered by dependency, so it can also be re-run over an existing database.

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
