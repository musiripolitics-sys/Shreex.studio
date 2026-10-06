/**
 * One PGlite database with the whole repository applied: schema.sql followed
 * by every migration in filename order.
 *
 * The existing suites each hand-pick the migrations they need, which keeps
 * them fast and focused. The guard suites cannot do that — a coverage check
 * that only loaded some tables would report coverage it had not measured.
 *
 * What this builds is what the REPOSITORY declares, not necessarily what is
 * applied in production. That is the right target for a guard: the repository
 * is what the next deployment will apply, and drift between the two is a
 * separate question (one this project has already been bitten by — 0013 was
 * skipped in production for months).
 */
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
import path from "path";

const MIGRATIONS = "supabase/migrations";

/** Stubs for the parts of Supabase that PGlite does not carry. */
const AUTH_SHIM = `create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(), email text,
  raw_user_meta_data jsonb, raw_app_meta_data jsonb, encrypted_password text,
  email_confirmed_at timestamptz, created_at timestamptz default now(),
  updated_at timestamptz default now());
create or replace function auth.uid() returns uuid language sql stable as
  $fn$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $fn$;
create or replace function auth.role() returns text language sql stable as
  $fn$ select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'anon') $fn$;
create role authenticated; create role anon; create role service_role;
create or replace function gen_random_bytes(n int) returns bytea language sql as
  $fn$ select decode(md5(random()::text),'hex') $fn$;
create or replace function crypt(a text,b text) returns text language sql as $fn$ select a $fn$;
create or replace function gen_salt(a text) returns text language sql as $fn$ select 'x' $fn$;
create domain citext as text;`;

const strip = (s) =>
  s.replace(/create extension if not exists (pgcrypto|citext);/g, "");

/**
 * Migration filenames in the order a deployment would apply them, from 0007.
 *
 * schema.sql is a consolidated snapshot that already contains 0001-0006, so
 * replaying those on top of it fails on types and policies that exist twice.
 * Starting at 0007 is what every existing suite does, and it reaches the same
 * 91 tables as production.
 */
export function migrationFiles() {
  return fs
    .readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql") && f >= "0007")
    .sort();
}

/**
 * A database with everything applied. Returns the handle plus the list of
 * files that failed, so a caller can report a broken migration rather than
 * silently measure a half-built schema.
 */
export async function freshDb({ quiet = false } = {}) {
  const db = new PGlite();
  await db.waitReady;
  await db.exec(AUTH_SHIM);

  const skipped = [];
  const files = ["../schema.sql", ...migrationFiles()];
  for (const f of files) {
    const p = path.join(MIGRATIONS, f);
    try {
      await db.exec(strip(fs.readFileSync(p, "utf8")));
    } catch (e) {
      skipped.push({ file: f, error: e.message });
      if (!quiet) console.log(`  ⚠️  ${f}: ${e.message.split("\n")[0]}`);
    }
  }

  await db.exec(`grant usage on schema public to anon, authenticated;
    grant select, insert, update, delete on all tables in schema public to anon, authenticated;
    grant execute on all functions in schema public to anon, authenticated;
    grant usage, select on all sequences in schema public to anon, authenticated;`);

  return { db, skipped };
}

/** The tiny assertion helper the other suites use, so output looks the same. */
export function counter() {
  const state = { pass: 0, fail: 0 };
  const ok = (c, m) => {
    c ? (state.pass++, console.log("  ✅ " + m))
      : (state.fail++, console.log("  ❌ " + m));
  };
  return { state, ok };
}
