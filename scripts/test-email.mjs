/**
 * Sends every email template through the real code path into a local SMTP
 * sink, then inspects what actually went out — subject present, correct From,
 * HTML body, and no undefined/NaN leaking from a missing field.
 *
 *   npm run test:email
 */
process.env.SMTP_HOST = "127.0.0.1";
process.env.SMTP_PORT = "2526";
process.env.SMTP_USER = "admin@techxfluence.com";
process.env.SMTP_PASS = "testtesttesttest";
process.env.EMAIL_FROM = "Techxfluence <admin@techxfluence.com>";
process.env.NEXT_PUBLIC_SITE_URL = "https://techxfluence.com";

const { startSink } = await import("./mail-sink.mjs");
const { server, messages } = await startSink(2526);
const M = await import("../.tmp/email.mjs");

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  ✅ " + m)) : (fail++, console.log("  ❌ " + m)); };

const cases = [
  ["registration confirmation", () => M.sendRegistrationConfirmation({
    to: "a@t.c", name: "Asha", eventTitle: "React Workshop", dateLabel: "Sep 19, 2026",
    time: "7:00 PM", venue: "IITM Research Park", city: "Chennai", ticketCode: "TXF-ABC123" })],
  ["waitlist joined", () => M.sendWaitlistJoined({
    to: "a@t.c", name: "Asha", eventTitle: "React Workshop", position: 3 })],
  ["waitlist promoted", () => M.sendWaitlistPromoted({
    to: "a@t.c", name: "Asha", eventTitle: "React Workshop", ticketCode: "txf-abc123" })],
  ["spot opened", () => M.sendSpotOpened({
    to: "a@t.c", name: "Asha", eventTitle: "React Workshop", slug: "react-workshop" })],
  ["event reminder", () => M.sendEventReminder({
    to: "a@t.c", name: "Asha", eventTitle: "React Workshop", dateLabel: "Sep 19, 2026",
    time: "7:00 PM", venue: "IITM", city: "Chennai", slug: "react-workshop", ticketCode: "TXF-ABC123" })],
  ["payment receipt", () => M.sendPaymentReceipt({
    to: "a@t.c", name: "Asha", description: "React Workshop ticket", amount: 49900,
    paymentRef: "pay_test123" })],
  ["membership renewal", () => M.sendMembershipRenewal({
    to: "a@t.c", name: "Asha", tier: "Pro", renewsOn: "Sep 30, 2026" })],
  ["attendee broadcast", () => M.sendAttendeeBroadcast({
    to: "a@t.c", name: "Asha", eventTitle: "React Workshop", subject: "Venue change",
    message: "We've moved to Hall B." })],
  ["host decision", () => M.sendHostDecision({
    to: "a@t.c", name: "Asha", approved: true })],
];

console.log("Sending every template through the real code path:\n");
const labelled = [];
for (const [label, fn] of cases) {
  const before = messages.length;
  try { await fn(); } catch (e) { ok(false, `${label} — threw: ${e.message}`); continue; }
  const sent = messages.length > before;
  ok(sent, `${label} — delivered`);
  if (sent) labelled.push([label, messages[messages.length - 1]]);
}

console.log("\nInspecting what actually went out:\n");
const decode = (raw) => {
  // Undo quoted-printable soft breaks and =XX escapes enough to scan text.
  const body = raw.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g,
    (_, h) => String.fromCharCode(parseInt(h, 16)));
  return body;
};

for (const [label, raw] of labelled) {
  const body = decode(raw);
  const subject = (raw.match(/^Subject: (.*)$/mi) || [])[1] ?? "";
  const problems = [];
  if (!subject.trim()) problems.push("no subject");
  const leak = body.match(/undefined|NaN|\[object Object\]/);
  if (leak) problems.push(`"${leak[0]}" leaked into the body`);
  if (!/admin@techxfluence\.com/.test(raw)) problems.push("wrong From");
  if (!/<html|<table/i.test(body)) problems.push("no HTML body");
  ok(problems.length === 0, `${label} — ${problems.length ? problems.join(", ") : "clean"}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
server.close();
process.exit(fail ? 1 : 0);
