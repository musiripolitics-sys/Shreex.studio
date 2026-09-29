/**
 * Verify SMTP credentials without sending anything.
 *
 *   node scripts/check-smtp.mjs            # auth check only
 *   node scripts/check-smtp.mjs you@x.com  # also send one test email
 *
 * Prints the exact server response so a rejection can be told apart from a
 * network or TLS problem. Never prints the password.
 */
import nodemailer from "nodemailer";
import fs from "fs";

const envPath = fs.existsSync(".env.local") ? ".env.local" : ".env";
if (!fs.existsSync(envPath)) {
  console.error(`No ${envPath} found — run this from the project root.`);
  process.exit(1);
}

const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const t = line.trim();
  if (t.includes("=") && !t.startsWith("#")) {
    const i = t.indexOf("=");
    let v = t.slice(i + 1).trim();
    // Next.js strips matching surrounding quotes when it loads .env, so this
    // must too — otherwise EMAIL_FROM arrives with literal quote characters
    // and nodemailer reads the whole thing as one malformed address, which
    // looks exactly like a server-side rejection.
    if (v.length > 1 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) {
      v = v.slice(1, -1);
    }
    env[t.slice(0, i).trim()] = v;
  }
}

const { SMTP_HOST: host, SMTP_USER: user, SMTP_PASS: pass } = env;
const from = env.EMAIL_FROM || user;
const port = Number(env.SMTP_PORT || 465);

if (!host) {
  console.error("Missing in " + envPath + ": SMTP_HOST");
  process.exit(1);
}

// smtp-relay.gmail.com can authenticate by IP alone, so a configuration with
// no credentials is valid rather than incomplete.
const relay = /smtp-relay\.gmail\.com/i.test(host);
const authenticating = Boolean(user && pass);

if (!relay && !authenticating) {
  console.error("Missing in " + envPath + ": SMTP_USER and SMTP_PASS are required for " + host);
  process.exit(1);
}

const redact = (s) => (pass ? String(s).split(pass).join("«hidden»") : String(s));

console.log(`host  ${host}:${port}`);
console.log(`user  ${user || "(none — relay authenticates by IP)"}`);
console.log(`from  ${from}`);
console.log(
  authenticating
    ? `pass  ${pass.length} chars` +
        (/^[a-z]{16}$/.test(pass)
          ? "  (valid App Password shape)"
          : "  ⚠️  a Google App Password is exactly 16 lowercase letters")
    : "pass  none — this host must allowlist your sending IP",
);
console.log("");

const transporter = nodemailer.createTransport({
  host,
  port,
  secure: port === 465,
  ...(authenticating ? { auth: { user, pass } } : {}),
  requireTLS: port !== 465,
  connectionTimeout: 15000,
  greetingTimeout: 15000,
});

try {
  await transporter.verify();
  console.log("✅ Authentication accepted.");
} catch (e) {
  const msg = redact(e.message).split("\n")[0];
  console.log(`❌ ${e.code ?? "ERROR"}: ${msg}`);

  if (String(e.message).includes("535")) {
    console.log(`
Google rejected the connection. In order of likelihood:

  1. The App Password was revoked. They die whenever the account password
     changes. Generate a fresh one and paste it into SMTP_PASS.

  2. ${user} is an alias or a Google Group, not a real mailbox.
     An alias cannot authenticate — there is no password behind it. Log in as
     the real mailbox instead, and keep EMAIL_FROM as the alias.

  3. 2-Step Verification is off on that account. App Passwords cannot exist
     without it, and existing ones stop working if it's turned off.

  4. Workspace admin policy blocks SMTP for this account.

Generate an App Password: https://myaccount.google.com/apppasswords
(sign in as ${user} first — the page is per-account)`);
  } else {
    console.log("\nThis looks like a network or TLS problem rather than a credential one.");
  }
  transporter.close();
  process.exit(2);
}

const to = process.argv[2];
if (to) {
  try {
    const info = await transporter.sendMail({
      from,
      to,
      subject: "Techxfluence SMTP test",
      text: "If you're reading this, SMTP is working.",
    });
    console.log(`✅ Test email accepted for delivery to ${to} (${info.messageId})`);
  } catch (e) {
    console.log(`❌ Auth worked but sending failed: ${redact(e.message).split("\n")[0]}`);
    if (String(e.message).includes("5.7.1") || String(e.message).includes("not allowed")) {
      console.log(
        `\nThis usually means ${user} isn't allowed to send as "${from}".\n` +
          `In Gmail: Settings → Accounts → "Send mail as" → add and verify the address.`,
      );
    }
    transporter.close();
    process.exit(3);
  }
} else {
  console.log("\nPass an address to also send a test email:");
  console.log("  node scripts/check-smtp.mjs you@example.com");
}
transporter.close();
