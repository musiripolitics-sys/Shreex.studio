import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

// Outbound mail, in either of the two shapes Google Workspace offers.
//
//   smtp.gmail.com       authenticates as a mailbox with an App Password.
//                        Needs 2-Step Verification on that account, and the
//                        password belongs to that account alone.
//
//   smtp-relay.gmail.com authenticates by IP instead. The sending host is
//                        allowlisted in the Admin console under Apps > Gmail >
//                        Routing > SMTP relay service, and no credential is
//                        used at all. That means it only works from a host
//                        with a fixed address.
//
// So credentials are optional: a relay with no SMTP_USER/SMTP_PASS is a valid
// configuration, not a broken one. Only the host is required.
//
// FROM falls back to the authenticated mailbox rather than a fixed address:
// you can always send as yourself, but sending as anyone else needs Gmail's
// "Send mail as" verification, and a wrong default fails at delivery time.
const FROM =
  process.env.EMAIL_FROM || process.env.SMTP_USER || "Techxfluence";

let _transporter: Transporter | null = null;
function getTransporter(): Transporter | null {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  if (_transporter) return _transporter;

  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const port = Number(process.env.SMTP_PORT || 465);

  _transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // 465 = SSL, 587 and 25 = STARTTLS
    // Relay by IP sends no AUTH at all. Passing an empty auth object would
    // make nodemailer try anyway and the relay would reject the session.
    ...(user && pass ? { auth: { user, pass } } : {}),
    // Insist on STARTTLS against a real server, but not against the loopback
    // sink the template tests speak to, which is plain TCP by design.
    requireTLS: port !== 465 && !/^(127\.|localhost$|::1$)/.test(host),
  });
  return _transporter;
}

/** Wraps content in the branded TXF email shell. */
function shell(heading: string, bodyHtml: string): string {
  return `
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
         style="background:#fbfbf9;padding:32px 0;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" role="presentation"
             style="background:#fff;border:1px solid #e6e5df;border-radius:16px;overflow:hidden;">
        <tr><td style="padding:28px 32px 0;">
          <span style="font-size:20px;font-weight:700;color:#0e0e0c;letter-spacing:-0.5px;">
            Tech<span style="color:#ff5a1f;">x</span>fluence
          </span>
        </td></tr>
        <tr><td style="padding:18px 32px 0;">
          <h1 style="margin:0;font-size:22px;line-height:1.3;font-weight:700;color:#0e0e0c;">${heading}</h1>
        </td></tr>
        <tr><td style="padding:14px 32px 28px;font-size:15px;line-height:1.6;color:#56564f;">
          ${bodyHtml}
        </td></tr>
      </table>
      <p style="margin:18px 0 0;font-size:12px;color:#8a897f;">© Techxfluence · Chennai, India</p>
    </td></tr>
  </table>`;
}

/**
 * Hand the message to Resend over HTTPS.
 *
 * An HTTP API rather than SMTP is the whole point: there is no connection to
 * authenticate, no IP to allowlist and no App Password to expire, so it works
 * the same from a laptop on a rotating consumer address and from a serverless
 * function with no fixed egress at all.
 */
async function sendViaResend(to: string, subject: string, html: string): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });
  if (!res.ok) {
    // Resend puts the useful part in the body; the status alone says little.
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${detail.slice(0, 300)}`);
  }
}

async function send(to: string, subject: string, html: string): Promise<void> {
  // The provider wins where it is configured. SMTP stays behind it so an
  // existing deployment keeps working without being touched.
  const viaResend = Boolean(process.env.RESEND_API_KEY);
  const transporter = viaResend ? null : getTransporter();

  if (!viaResend && !transporter) {
    console.warn(
      `[email] neither RESEND_API_KEY nor SMTP_HOST is set — skipping "${subject}" to ${to}`,
    );
    return;
  }
  try {
    if (viaResend) await sendViaResend(to, subject, html);
    else await transporter!.sendMail({ from: FROM, to, subject, html });
  } catch (err) {
    // Best-effort: never let an email failure break the main flow — but
    // record it, because a silent failure is how a dead SMTP password goes
    // unnoticed for weeks.
    console.error(`[email] failed to send "${subject}" to ${to}:`, err);
    await recordFailure(to, subject, err);
  }
}

/** Log a delivery failure for the admin console. Never throws. */
async function recordFailure(to: string, subject: string, err: unknown) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return;

    const { createClient } = await import("@supabase/supabase-js");
    const admin = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await admin.from("email_failures").insert({
      recipient: to,
      subject,
      error: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
    });
  } catch {
    // If even the logging fails, the console line above is all we get.
  }
}

function fmtAmount(paise: number, currency = "INR"): string {
  const symbol = currency === "INR" ? "₹" : "";
  return `${symbol}${(paise / 100).toLocaleString("en-IN")}`;
}

export async function sendRegistrationConfirmation(opts: {
  to: string;
  name: string;
  eventTitle: string;
  ticketCode: string;
  dateLabel?: string | null;
  venue?: string | null;
  /** Additional ticket codes when more than one seat was booked. */
  extraTickets?: string[];
}): Promise<void> {
  const details = [
    opts.dateLabel ? `<strong>When:</strong> ${opts.dateLabel}` : null,
    opts.venue ? `<strong>Where:</strong> ${opts.venue}` : null,
  ]
    .filter(Boolean)
    .join("<br/>");

  await send(
    opts.to,
    `You're registered — ${opts.eventTitle}`,
    shell(
      "You're registered! 🎟️",
      `Hi ${opts.name}, your spot for <strong>${opts.eventTitle}</strong> is confirmed.
       ${details ? `<p style="margin:14px 0 0;">${details}</p>` : ""}
       <p style="margin:18px 0 6px;font-size:13px;color:#8a897f;">Your ticket code</p>
       <div style="display:inline-block;border:1px solid #e6e5df;border-radius:8px;padding:10px 18px;
                   font-family:monospace;font-size:20px;font-weight:700;letter-spacing:3px;color:#0e0e0c;">
         ${opts.ticketCode.toUpperCase()}
       </div>
       ${
         opts.extraTickets?.length
           ? `<p style="margin:16px 0 6px;font-size:13px;color:#8a897f;">Your other tickets</p>
              <p style="margin:0;font-family:monospace;font-size:15px;color:#0e0e0c;">
                ${opts.extraTickets.map((c) => c.toUpperCase()).join("<br/>")}
              </p>`
           : ""
       }
       <p style="margin:18px 0 0;">Show this code at check-in. See you there!</p>`,
    ),
  );
}

export async function sendWaitlistJoined(opts: {
  to: string;
  name: string;
  eventTitle: string;
}): Promise<void> {
  await send(
    opts.to,
    `You're on the waitlist — ${opts.eventTitle}`,
    shell(
      "You're on the waitlist ⏳",
      `Hi ${opts.name}, <strong>${opts.eventTitle}</strong> is currently full, but
       we've added you to the waitlist. If a spot opens up, you'll be moved in
       automatically and we'll email you straight away.`,
    ),
  );
}

export async function sendWaitlistPromoted(opts: {
  to: string;
  name: string;
  eventTitle: string;
  ticketCode: string;
}): Promise<void> {
  await send(
    opts.to,
    `A spot opened up — you're in for ${opts.eventTitle}! 🎉`,
    shell(
      "You're off the waitlist! 🎉",
      `Hi ${opts.name}, good news — a spot opened up and you're now confirmed for
       <strong>${opts.eventTitle}</strong>.
       <p style="margin:18px 0 6px;font-size:13px;color:#8a897f;">Your ticket code</p>
       <div style="display:inline-block;border:1px solid #e6e5df;border-radius:8px;padding:10px 18px;
                   font-family:monospace;font-size:20px;font-weight:700;letter-spacing:3px;color:#0e0e0c;">
         ${opts.ticketCode.toUpperCase()}
       </div>
       <p style="margin:18px 0 0;">Show this at the door. See you there!</p>`,
    ),
  );
}

export async function sendMembershipRenewal(opts: {
  to: string;
  name: string;
  tier: string;
  expired: boolean;
}): Promise<void> {
  const url = `${process.env.NEXT_PUBLIC_SITE_URL || ""}/membership`;
  await send(
    opts.to,
    opts.expired
      ? `Your ${opts.tier} membership has expired`
      : `Your ${opts.tier} membership renews in 3 days`,
    shell(
      opts.expired ? "Membership expired" : "Renewal coming up ⏳",
      `Hi ${opts.name}, your <strong>${opts.tier}</strong> membership
       ${opts.expired ? "has expired — your member discounts and perks are paused." : "expires in 3 days."}
       Renew to keep your ticket discounts and member perks running.
       <p style="margin:18px 0 0;">
         <a href="${url}" style="display:inline-block;background:#ff5a1f;color:#fff;text-decoration:none;
            font-weight:600;padding:11px 22px;border-radius:9999px;">Renew membership</a>
       </p>`,
    ),
  );
}

export async function sendSpotOpened(opts: {
  to: string;
  name: string;
  eventTitle: string;
  slug: string;
}): Promise<void> {
  const url = `${process.env.NEXT_PUBLIC_SITE_URL || ""}/events/${opts.slug}`;
  await send(
    opts.to,
    `A spot just opened — ${opts.eventTitle}`,
    shell(
      "A spot just opened 🎟️",
      `Hi ${opts.name}, you're on the waitlist for <strong>${opts.eventTitle}</strong>
       and a seat has just been freed. You're first in line — but it's first come,
       first served.
       <p style="margin:18px 0 0;">
         <a href="${url}" style="display:inline-block;background:#ff5a1f;color:#fff;text-decoration:none;
            font-weight:600;padding:11px 22px;border-radius:9999px;">Grab your ticket</a>
       </p>`,
    ),
  );
}

export async function sendEventReminder(opts: {
  to: string;
  name: string;
  eventTitle: string;
  dateLabel?: string | null;
  time?: string | null;
  venue?: string | null;
  ticketCode: string;
}): Promise<void> {
  const when = [opts.dateLabel, opts.time].filter(Boolean).join(" · ");
  await send(
    opts.to,
    `Reminder: ${opts.eventTitle} is coming up`,
    shell(
      "See you soon! ⏰",
      `Hi ${opts.name}, this is a friendly reminder that
       <strong>${opts.eventTitle}</strong> is almost here.
       ${when ? `<p style="margin:14px 0 0;"><strong>When:</strong> ${when}</p>` : ""}
       ${opts.venue ? `<p style="margin:4px 0 0;"><strong>Where:</strong> ${opts.venue}</p>` : ""}
       <p style="margin:18px 0 6px;font-size:13px;color:#8a897f;">Your ticket code</p>
       <div style="display:inline-block;border:1px solid #e6e5df;border-radius:8px;padding:10px 18px;
                   font-family:monospace;font-size:20px;font-weight:700;letter-spacing:3px;color:#0e0e0c;">
         ${opts.ticketCode.toUpperCase()}
       </div>
       <p style="margin:18px 0 0;">Show this code at the door. Can't wait to see you!</p>`,
    ),
  );
}

export async function sendAttendeeBroadcast(opts: {
  to: string;
  name: string;
  eventTitle: string;
  message: string;
}): Promise<void> {
  const safe = opts.message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>");
  await send(
    opts.to,
    `Update: ${opts.eventTitle}`,
    shell(
      `An update from ${opts.eventTitle}`,
      `Hi ${opts.name},
       <p style="margin:14px 0 0;">${safe}</p>
       <p style="margin:18px 0 0;font-size:13px;color:#8a897f;">
         You're receiving this because you're registered for this event.
       </p>`,
    ),
  );
}

export async function sendPaymentReceipt(opts: {
  to: string;
  name: string;
  description: string;
  amount: number;
  currency?: string;
  paymentRef: string;
}): Promise<void> {
  await send(
    opts.to,
    `Payment receipt — ${opts.description}`,
    shell(
      "Payment received ✅",
      `Hi ${opts.name}, thanks for your payment.
       <table style="margin-top:14px;font-size:14px;color:#0e0e0c;">
         <tr><td style="padding:4px 16px 4px 0;color:#8a897f;">Item</td><td>${opts.description}</td></tr>
         <tr><td style="padding:4px 16px 4px 0;color:#8a897f;">Amount</td><td>${fmtAmount(opts.amount, opts.currency)}</td></tr>
         <tr><td style="padding:4px 16px 4px 0;color:#8a897f;">Reference</td><td style="font-family:monospace;">${opts.paymentRef}</td></tr>
       </table>
       <p style="margin:18px 0 0;font-size:13px;color:#8a897f;">Keep this email for your records.</p>`,
    ),
  );
}

export async function sendHostDecision(opts: {
  to: string;
  name: string;
  approved: boolean;
}): Promise<void> {
  if (opts.approved) {
    await send(
      opts.to,
      "Your Host access is approved 🎉",
      shell(
        "You're now a Host 🎉",
        `Hi ${opts.name}, your request for Host access has been approved. You can now
         submit events for approval and manage your attendees from your dashboard.
         <p style="margin:18px 0 0;">
           <a href="${process.env.NEXT_PUBLIC_SITE_URL || ""}/host/dashboard"
              style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;
                     font-weight:600;padding:11px 22px;border-radius:9999px;">Go to Host dashboard</a>
         </p>`,
      ),
    );
  } else {
    await send(
      opts.to,
      "Update on your Host request",
      shell(
        "Host request update",
        `Hi ${opts.name}, thanks for your interest in hosting. Your Host access request
         wasn't approved at this time. You still have full Community Member access, and
         you're welcome to reach out via our contact page if you'd like to discuss it.`,
      ),
    );
  }
}

// ─────────────────────────── Business OS: tasks ───────────────────────────
//
// Work changes hands inside the OS, but people do not live in the OS. The
// notification bell (0021) reaches whoever happens to open it; these reach
// them where they actually are.

const osUrl = (path: string) => `${process.env.NEXT_PUBLIC_SITE_URL || ""}${path}`;

function button(href: string, label: string, colour = "#ff5a1f"): string {
  return `<p style="margin:18px 0 0;">
    <a href="${href}" style="display:inline-block;background:${colour};color:#fff;text-decoration:none;
       font-weight:600;padding:11px 22px;border-radius:9999px;">${label}</a>
  </p>`;
}

/** Facts table shared by the task emails, so they read the same way. */
function facts(rows: [string, string | null | undefined][]): string {
  const body = rows
    .filter(([, v]) => v)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 16px 4px 0;color:#8a897f;white-space:nowrap;">${k}</td><td>${v}</td></tr>`,
    )
    .join("");
  return body ? `<table style="margin-top:14px;font-size:14px;color:#0e0e0c;">${body}</table>` : "";
}

const taskLabel = (code: string | null, title: string) =>
  `${code ? `${code} · ` : ""}${title}`;

export async function sendTaskAssigned(opts: {
  to: string;
  name: string;
  code: string | null;
  title: string;
  description?: string | null;
  dueDate?: string | null;
  priority?: string | null;
  goal?: string | null;
  assignedBy?: string | null;
  taskId: string;
}): Promise<void> {
  await send(
    opts.to,
    `Assigned to you: ${taskLabel(opts.code, opts.title)}`,
    shell(
      "You have a new task 📋",
      `Hi ${opts.name}, ${opts.assignedBy ? `${opts.assignedBy} assigned` : "you have been assigned"}
       <strong>${opts.title}</strong>.
       ${opts.description ? `<p style="margin:14px 0 0;">${opts.description}</p>` : ""}
       ${facts([
         ["Due", opts.dueDate],
         ["Priority", opts.priority],
         ["Goal", opts.goal],
       ])}
       ${button(osUrl(`/admin/os/tasks?task=${opts.taskId}`), "Open the task")}`,
    ),
  );
}

export async function sendTaskDecision(opts: {
  to: string;
  name: string;
  code: string | null;
  title: string;
  approved: boolean;
  note?: string | null;
  decidedBy?: string | null;
  taskId: string;
}): Promise<void> {
  await send(
    opts.to,
    `${opts.approved ? "Approved" : "Sent back"}: ${taskLabel(opts.code, opts.title)}`,
    shell(
      opts.approved ? "Your work was approved ✅" : "Your work came back",
      opts.approved
        ? `Hi ${opts.name}, <strong>${opts.title}</strong> was approved${
            opts.decidedBy ? ` by ${opts.decidedBy}` : ""
          } and the task is now complete. Nothing more to do.
           ${button(osUrl(`/admin/os/tasks?task=${opts.taskId}`), "See the task", "#16a34a")}`
        : `Hi ${opts.name}, <strong>${opts.title}</strong> was sent back${
            opts.decidedBy ? ` by ${opts.decidedBy}` : ""
          } and needs another look.
           ${opts.note ? `<p style="margin:14px 0 0;"><strong>Reason:</strong> ${opts.note}</p>` : ""}
           ${button(osUrl(`/admin/os/tasks?task=${opts.taskId}`), "Pick it back up")}`,
    ),
  );
}

export async function sendTaskSubmitted(opts: {
  to: string;
  name: string;
  code: string | null;
  title: string;
  submittedBy: string | null;
  taskId: string;
}): Promise<void> {
  await send(
    opts.to,
    `Needs your approval: ${taskLabel(opts.code, opts.title)}`,
    shell(
      "A task is waiting on you",
      `Hi ${opts.name}, ${opts.submittedBy ?? "Someone"} has finished
       <strong>${opts.title}</strong> and submitted it for approval. It stays open
       until you approve it.
       ${button(osUrl(`/admin/os/tasks?task=${opts.taskId}`), "Review it")}`,
    ),
  );
}

export async function sendTaskReviewed(opts: {
  to: string;
  name: string;
  code: string | null;
  title: string;
  outcome: "met" | "partial" | "missed";
  quality?: number | null;
  learning?: string | null;
  reviewedBy?: string | null;
}): Promise<void> {
  const verdict = { met: "Met the goal", partial: "Partially met", missed: "Missed" }[opts.outcome];
  await send(
    opts.to,
    `Reviewed: ${taskLabel(opts.code, opts.title)}`,
    shell(
      "Your work was reviewed",
      `Hi ${opts.name}, <strong>${opts.title}</strong> has been reviewed${
        opts.reviewedBy ? ` by ${opts.reviewedBy}` : ""
      }.
       ${facts([
         ["Outcome", verdict],
         ["Quality", opts.quality != null ? `${opts.quality} of 5` : null],
       ])}
       ${opts.learning ? `<p style="margin:16px 0 0;"><strong>Carry forward:</strong> ${opts.learning}</p>` : ""}
       ${button(osUrl("/admin/os/reviews?tab=tasks"), "Read the review")}`,
    ),
  );
}

// ───────────────────── Onboarding, forms and approvals ─────────────────────

/**
 * A new employee has an account.
 *
 * Deliberately no password. An admin sets one when creating the account and
 * hands it over directly; putting it in an email would leave the credential
 * sitting in two mailboxes forever. The reset link covers anyone who was not
 * told, or who forgets.
 */
export async function sendEmployeeWelcome(opts: {
  to: string;
  name: string;
  title?: string | null;
  sections: string[];
}): Promise<void> {
  const site = process.env.NEXT_PUBLIC_SITE_URL || "";
  await send(
    opts.to,
    "Your Techxfluence Business OS account is ready",
    shell(
      "Welcome to the team 👋",
      `Hi ${opts.name}, your account for the Techxfluence Business OS is ready${
        opts.title ? `, as <strong>${opts.title}</strong>` : ""
      }.
       ${
         opts.sections.length
           ? `<p style="margin:14px 0 0;">You have access to: <strong>${opts.sections.join(", ")}</strong>.
              Anything else stays hidden until someone grants it.</p>`
           : ""
       }
       <p style="margin:14px 0 0;">Sign in with this address. Whoever set your
       account up has your password — if you do not have it, use
       <em>Forgot password</em> on the sign-in page and set your own.</p>
       ${button(`${site}/admin/os`, "Open the Business OS")}`,
    ),
  );
}

/** Someone used the contact form. Sent to them, so they know it arrived. */
export async function sendContactReceived(opts: {
  to: string;
  name: string;
  subject?: string | null;
}): Promise<void> {
  await send(
    opts.to,
    "We got your message",
    shell(
      "Thanks for getting in touch",
      `Hi ${opts.name}, we have your message${
        opts.subject ? ` about <strong>${opts.subject}</strong>` : ""
      } and someone will reply, usually within a couple of working days.
       <p style="margin:14px 0 0;">No need to send it again — this is just to
       confirm it reached us.</p>`,
    ),
  );
}

/** Someone proposed an event. Sent to them. */
export async function sendHostProposalReceived(opts: {
  to: string;
  name: string;
  eventTitle?: string | null;
}): Promise<void> {
  await send(
    opts.to,
    "We got your event proposal",
    shell(
      "Your proposal is in 🎤",
      `Hi ${opts.name}, thanks for proposing${
        opts.eventTitle ? ` <strong>${opts.eventTitle}</strong>` : " an event"
      }. Someone from the team reviews every proposal by hand, so give us a few
       days — you will hear back either way.`,
    ),
  );
}

export async function sendNewsletterWelcome(opts: { to: string }): Promise<void> {
  const site = process.env.NEXT_PUBLIC_SITE_URL || "";
  await send(
    opts.to,
    "You're subscribed to Techxfluence",
    shell(
      "You're on the list 📬",
      `Thanks for subscribing. You will hear from us when there is something
       worth hearing about — new events, what happened at the last one, and
       what the community is building. Not more often than that.
       ${button(`${site}/events`, "See what's on")}`,
    ),
  );
}

/** Something needs a decision. Sent to whoever can make it. */
export async function sendInternalAlert(opts: {
  to: string;
  name: string;
  heading: string;
  what: string;
  details?: [string, string | null | undefined][];
  href: string;
  cta: string;
}): Promise<void> {
  await send(
    opts.to,
    opts.heading,
    shell(
      opts.heading,
      `Hi ${opts.name}, ${opts.what}
       ${opts.details ? facts(opts.details) : ""}
       ${button(`${process.env.NEXT_PUBLIC_SITE_URL || ""}${opts.href}`, opts.cta)}`,
    ),
  );
}

/** A request in the approvals queue was decided. Sent to whoever raised it. */
export async function sendApprovalDecision(opts: {
  to: string;
  name: string;
  requestType: string;
  requestTitle: string;
  approved: boolean;
  comments?: string | null;
}): Promise<void> {
  await send(
    opts.to,
    `${opts.approved ? "Approved" : "Not approved"}: ${opts.requestTitle}`,
    shell(
      opts.approved ? "Your request was approved ✅" : "Your request was not approved",
      `Hi ${opts.name}, your ${opts.requestType.toLowerCase()} request
       — <strong>${opts.requestTitle}</strong> — was
       ${opts.approved ? "approved" : "declined"}.
       ${opts.comments ? `<p style="margin:14px 0 0;"><strong>Note:</strong> ${opts.comments}</p>` : ""}
       ${button(`${process.env.NEXT_PUBLIC_SITE_URL || ""}/admin/os/approvals`, "See the request")}`,
    ),
  );
}
