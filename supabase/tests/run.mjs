/**
 * Runs every suite in this directory and exits non-zero if any fails.
 *
 * Until now the suites existed but nothing ran them together, so a guard in
 * here guarded nothing: it would only fail for whoever happened to run that
 * one file. Each suite is its own process because each builds its own PGlite
 * database and they must not share state.
 *
 *   npm test                 — everything
 *   npm test tenancy         — only suites whose name contains "tenancy"
 */
import { spawn } from "node:child_process";
import fs from "fs";
import path from "path";

const dir = "supabase/tests";
const filter = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".test.mjs"))
  .filter((f) => filter.length === 0 || filter.some((s) => f.includes(s)))
  .sort();

if (files.length === 0) {
  console.error(`No suites matched ${filter.join(", ")}`);
  process.exit(1);
}

const run = (f) =>
  new Promise((resolve) => {
    const out = [];
    const p = spawn(process.execPath, [path.join(dir, f)], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", (d) => out.push(d));
    p.on("close", (code) => resolve({ f, code, out: Buffer.concat(out).toString() }));
  });

const results = [];
for (const f of files) {
  const r = await run(f);
  results.push(r);
  const tail = r.out.match(/(\d+) passed, (\d+) failed/);
  const label = tail ? `${tail[1]} passed, ${tail[2]} failed` : r.code === 0 ? "ok" : "no summary";
  console.log(`${r.code === 0 ? "✅" : "❌"}  ${f.replace(".test.mjs", "").padEnd(22)} ${label}`);
  // Only the failing suites print their detail, so a green run stays readable.
  if (r.code !== 0) console.log(r.out.split("\n").map((l) => "    " + l).join("\n"));
}

const failed = results.filter((r) => r.code !== 0);
const totals = results.reduce(
  (a, r) => {
    const m = r.out.match(/(\d+) passed, (\d+) failed/);
    if (m) { a.pass += +m[1]; a.fail += +m[2]; }
    return a;
  },
  { pass: 0, fail: 0 },
);
console.log(
  `\n${results.length} suites, ${totals.pass} assertions passed, ${totals.fail} failed` +
    (failed.length ? ` — failing: ${failed.map((r) => r.f).join(", ")}` : ""),
);
process.exit(failed.length ? 1 : 0);
