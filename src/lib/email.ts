import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

// Google Workspace / Gmail SMTP. Requires an App Password on the sending
// account (2-Step Verification must be on). All vars come from env.
const FROM =
  process.env.EMAIL_FROM || "Techxfluence <contact@techxfluence.com>";

let _transporter: Transporter | null = null;
function getTransporter(): Transporter | null {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  if (_transporter) return _transporter;
  const port = Number(process.env.SMTP_PORT || 465);
  _transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // 465 = SSL, 587 = STARTTLS
    auth: { user, pass },
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

async function send(to: string, subject: string, html: string): Promise<void> {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn(`[email] SMTP not configured — skipping "${subject}" to ${to}`);
    return;
  }
  try {
    await transporter.sendMail({ from: FROM, to, subject, html });
  } catch (err) {
    // Best-effort: never let an email failure break the main flow.
    console.error(`[email] failed to send "${subject}" to ${to}:`, err);
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
