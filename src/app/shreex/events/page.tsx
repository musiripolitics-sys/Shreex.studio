import { createClient } from "@/lib/supabase/server";
import { EventsClient, type EventRow, type EventOps } from "./EventsClient";
import { requireSection } from "@/lib/os-access";

export const metadata = { title: "Events · Shreex" };

export default async function EventsBosPage() {
  await requireSection("events");
  const supabase = await createClient();

  const [{ data: events }, { data: ops }, { data: regs }, { data: payments }, { data: campaigns }, { data: owners }] =
    await Promise.all([
      supabase.from("events").select("id,title,category,date,city,status,capacity,host_name").order("date", { ascending: false }).limit(300),
      supabase.from("event_ops").select("*"),
      supabase.from("registrations").select("event_id,status"),
      supabase.from("payments").select("related_id,amount,related_type,status").eq("related_type", "events").eq("status", "paid"),
      supabase.from("campaigns").select("id,name").order("created_at", { ascending: false }),
      supabase.from("users").select("id,full_name,email").in("primary_role", ["admin", "employee", "event_host"]).order("full_name"),
    ]);

  // Aggregate registrations / attendance / revenue per event.
  const regCount = new Map<string, number>();
  const attCount = new Map<string, number>();
  for (const r of regs ?? []) {
    if (r.status === "registered" || r.status === "attended") regCount.set(r.event_id, (regCount.get(r.event_id) ?? 0) + 1);
    if (r.status === "attended") attCount.set(r.event_id, (attCount.get(r.event_id) ?? 0) + 1);
  }
  const revenue = new Map<string, number>();
  for (const p of payments ?? []) if (p.related_id) revenue.set(p.related_id, (revenue.get(p.related_id) ?? 0) + (p.amount ?? 0));

  const rows: EventRow[] = (events ?? []).map((e) => ({
    ...e,
    registrations: regCount.get(e.id) ?? 0,
    attendance: attCount.get(e.id) ?? 0,
    revenue: revenue.get(e.id) ?? 0,
  }));

  const opsMap: Record<string, EventOps> = {};
  for (const o of (ops as EventOps[]) ?? []) opsMap[o.event_id] = o;

  return (
    <EventsClient
      rows={rows}
      ops={opsMap}
      campaigns={(campaigns as { id: string; name: string }[]) ?? []}
      owners={(owners as { id: string; full_name: string | null; email: string | null }[]) ?? []}
    />
  );
}
