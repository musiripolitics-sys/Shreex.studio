import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendEventReminder, sendMembershipRenewal } from "@/lib/email";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  attendee_name: string;
  attendee_email: string;
  ticket_code: string | null;
  events: {
    title: string;
    date_label: string | null;
    time: string | null;
    venue: string | null;
  } | null;
};

/**
 * Sends a reminder to every attendee whose event is today or tomorrow and who
 * hasn't been reminded yet. Idempotent via registrations.reminded_at, so it's
 * safe to run on a schedule (or manually). Secured by CRON_SECRET.
 *
 * Trigger daily — e.g. Vercel Cron (vercel.json) or any scheduler hitting:
 *   GET /api/cron/reminders   with  Authorization: Bearer <CRON_SECRET>
 *   (or ?key=<CRON_SECRET>)
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  const key = new URL(request.url).searchParams.get("key");
  if (!secret || (auth !== `Bearer ${secret}` && key !== secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Window: events happening today or tomorrow (date-only granularity).
  const day = (n: number) =>
    new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const from = day(0);
  const to = day(1);

  const { data, error } = await admin
    .from("registrations")
    .select(
      "id, attendee_name, attendee_email, ticket_code, events!inner(title, date_label, time, venue, date, status)",
    )
    .is("reminded_at", null)
    .eq("status", "registered")
    .eq("events.status", "published")
    .gte("events.date", from)
    .lte("events.date", to);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as Row[];
  let sent = 0;
  for (const r of rows) {
    await sendEventReminder({
      to: r.attendee_email,
      name: r.attendee_name,
      eventTitle: r.events?.title ?? "your event",
      dateLabel: r.events?.date_label,
      time: r.events?.time,
      venue: r.events?.venue,
      ticketCode: r.ticket_code ?? "",
    });
    // Mark reminded regardless (best-effort email) to avoid retry storms.
    await admin
      .from("registrations")
      .update({ reminded_at: new Date().toISOString() })
      .eq("id", r.id);
    sent++;
  }

  // ---- Lifecycle: archive events whose date has passed ----
  const { data: completed } = await admin
    .from("events")
    .update({ status: "completed" })
    .eq("status", "published")
    .lt("date", from)
    .select("id");

  // ---- Membership renewals: nudge at T-3 days and on expiry day ----
  let renewalNotices = 0;
  for (const { offset, expired } of [
    { offset: 3, expired: false },
    { offset: 0, expired: true },
  ]) {
    const target = day(offset);
    const { data: due } = await admin
      .from("memberships")
      .select("user_id, tier, renews_at, users(email, full_name)")
      .eq("status", "active")
      .gte("renews_at", `${target}T00:00:00Z`)
      .lt("renews_at", `${target}T23:59:59Z`);

    for (const m of due ?? []) {
      const u = m.users as unknown as { email: string | null; full_name: string | null } | null;
      await admin.from("notifications").insert({
        user_id: m.user_id,
        type: "membership",
        title: expired
          ? `Your ${m.tier} membership has expired`
          : `Your ${m.tier} membership renews in 3 days`,
        body: "Renew to keep your ticket discounts and member perks.",
        link: "/membership",
      });
      if (u?.email) {
        await sendMembershipRenewal({
          to: u.email,
          name: u.full_name || "there",
          tier: m.tier,
          expired,
        });
      }
      renewalNotices++;
    }
  }

  // ---- Release seats held by checkouts that were never completed ----
  const { data: expiredOrders } = await admin.rpc("expire_pending_orders");

  return NextResponse.json({
    ok: true,
    scanned: rows.length,
    sent,
    ordersExpired: expiredOrders ?? 0,
    eventsCompleted: completed?.length ?? 0,
    renewalNotices,
  });
}
