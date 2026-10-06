/**
 * The daily reminder run.
 *
 * This used to be declared in vercel.json, which Netlify does not read — so
 * since the move it has never fired, and no attendee has ever had a reminder.
 *
 * The work itself stays in the app at /api/cron/reminders: it already holds
 * the database credentials, the email templates and the idempotency (a
 * registration is stamped `reminded_at` as it goes, so a double run sends
 * nothing twice). This only wakes it up, which keeps one implementation of
 * the job rather than a second copy that drifts.
 */
export default async () => {
  const base = process.env.NEXT_PUBLIC_SITE_URL || process.env.URL;
  const secret = process.env.CRON_SECRET;

  if (!base || !secret) {
    // Returning 500 makes this show up as a failed run in Netlify rather than
    // succeeding silently while doing nothing, which is how the old one hid.
    console.error("[reminders] NEXT_PUBLIC_SITE_URL or CRON_SECRET is not set");
    return new Response("Not configured", { status: 500 });
  }

  const res = await fetch(`${base}/api/cron/reminders`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await res.text();

  if (!res.ok) {
    console.error(`[reminders] ${res.status}: ${body.slice(0, 300)}`);
    return new Response(body, { status: res.status });
  }

  console.log(`[reminders] ${body.slice(0, 300)}`);
  return new Response(body, { status: 200 });
};

// 03:00 UTC — 08:30 in Chennai, so a reminder lands with somebody's morning
// rather than overnight.
export const config = { schedule: "0 3 * * *" };
