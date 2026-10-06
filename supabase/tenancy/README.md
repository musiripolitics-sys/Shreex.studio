# Tenancy manifests

Two checked-in files that the Stage 0 guard suites read. They exist so that a
change which would break tenant isolation fails at review time rather than
after Stage 4 has made somebody's rows invisible.

| File | Enforced by | What it records |
| --- | --- | --- |
| `tables.json` | `supabase/tests/tenancy-tables.test.mjs` | Every table in `public`, classified tenant / identity / platform, plus every unique constraint on a tenant-owned table and whether it needs `tenant_id` |
| `definer-functions.json` | `supabase/tests/tenancy-definers.test.mjs` | Every `SECURITY DEFINER` function, grouped A to E by cross-tenant risk, with what scopes it today |

## Why a file rather than a list in the test

Both suites enumerate from the catalogue — `pg_class`, `pg_constraint`,
`pg_proc` — and compare against these files. A table or function in the
database but not the file fails; one in the file but not the database fails
too, so dead entries get removed. The consequence is the point: **a new table
or a new definer function ships failing** until somebody has said what it is.

## When you touch one

- **New table** → add it to `tenant`, `identity` or `platform` in
  `tables.json`, with a sentence saying why.
- **New unique constraint on a tenant-owned table** → add it to
  `needsTenantId` or `alreadySafe`. A unique constraint that does not include
  the tenant makes two tenants collide; `alreadySafe` is for constraints whose
  every column is a foreign key to a row that already carries the tenant.
- **New `SECURITY DEFINER` function** → add it to `definer-functions.json`
  with a group and a scope. If you are reaching for `security definer` to get
  past RLS, consider whether a policy would do instead: every definer function
  added is one Stage 5 has to audit.
- **Turning on `FORCE ROW LEVEL SECURITY`** → raise `forceRlsBaseline` to the
  new count. The guard refuses to let it go down.

## What is not here yet

The check that matters most — run every row-spanning function as two tenants
and assert the results are disjoint — cannot run until a second tenant exists.
Until then it would pass vacuously, which is worse than not running, so
`tenancy-definers.test.mjs` reports it as pending. It lands with the empty
test tenant in Stage 6.
