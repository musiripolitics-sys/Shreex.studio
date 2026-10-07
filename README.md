# Shreex

Shreex runs businesses. Each one gets its own plan, people, events, money,
marketing, compliance and reporting, and sees nothing belonging to any other.

This is the platform, not any business on it. **Techxfluence is one tenant of
Shreex** — nothing more. Its public site (events, membership, community, the
service studio) lives in its own repository and is not part of this one. The
only thing the two share is this database.

## Shape

| Path | What it is |
| --- | --- |
| `/shreex` | routes by who you are: platform administrator to the console, everyone else to their business |
| `/shreex/dashboard` | the business dashboard |
| `/shreex/platform` | the platform console — organisations, their administrators, platform admins |
| `/shreex/<product>` | the nine products: plan, events, money, grow, marketing, team, product, govern, insights |
| `/login`, `/invite/[token]` | getting in, and joining a business you were invited to |
| `supabase/` | the schema every tenant runs on. Shreex owns it; a tenant app only reads it |

## Isolation

The part worth understanding before changing anything.

Every tenant-owned table carries `tenant_id` and an `AS RESTRICTIVE` policy
comparing it to `bos_request_tenant()`. Restrictive matters: Postgres combines
permissive policies with OR, so a permissive isolation policy would be satisfied
by any other permissive policy on the table. Restrictive ones are AND-ed with
all of them, including the admin ones.

A super admin reaches every business and stands in **one at a time** — entering
one is written to that business's own audit log. Platform authority is a row in
`platform_admins`, not a membership anywhere.

The `bos_` prefix on database objects is historical: it is what this was called
before it was Shreex. 140 policies and 103 column defaults name those functions,
so renaming them would mean recreating the isolation layer for an identifier no
user reads. `supabase/tenancy/` records the classification of every table and
every `SECURITY DEFINER` function, and the test suite fails the build if a new
one appears unclassified.

## Running it

```
npm install
npm run dev          # port 3100, so it can run beside the Techxfluence app
npm test             # 44 suites against real Postgres, via PGlite
```

`npm test` applies `supabase/schema.sql` and every migration to an in-process
Postgres and asserts against it, so a policy change is checked rather than
reasoned about. It also replays every migration a second time, because a
migration that cannot be re-run cannot be recovered from.

## Migrations

Run them in the Supabase SQL editor, in filename order. They are idempotent and
safe to re-run — there is a test for that, added after one of them was not.
