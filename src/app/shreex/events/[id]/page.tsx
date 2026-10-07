import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireSection } from "@/lib/os-access";
import { EventDetail, type EventFull, type Registration } from "./EventDetail";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("events").select("title").eq("id", id).maybeSingle();
  return { title: `${(data as { title?: string } | null)?.title ?? "Event"} · Shreex` };
}

/**
 * One event, everything about it: what the website shows, what it has sold,
 * and who is coming. The list at /shreex/events answers "how are we doing";
 * this answers "what is happening at this one".
 */
export default async function EventPage({ params }: { params: Params }) {
  await requireSection("events");
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: event }, { data: regs }, { data: payments }, { data: owners }] = await Promise.all([
    supabase.from("events").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("registrations")
      .select("id,attendee_name,attendee_email,attendee_phone,status,ticket_code,checked_in_at,registered_at")
      .eq("event_id", id)
      .order("registered_at", { ascending: false }),
    supabase
      .from("payments")
      .select("amount,status")
      .eq("related_type", "events")
      .eq("related_id", id)
      .eq("status", "paid"),
    supabase
      .from("users")
      .select("id,full_name,email")
      .in("primary_role", ["admin", "employee", "event_host"])
      .order("full_name"),
  ]);

  if (!event) notFound();

  const revenue = ((payments as { amount: number }[]) ?? []).reduce((a, p) => a + (p.amount ?? 0), 0);

  return (
    <>
      <Link
        href="/shreex/events"
        className="mb-3 inline-block text-xs font-medium text-muted hover:text-brand"
      >
        ← All events
      </Link>
      <EventDetail
        event={event as EventFull}
        registrations={(regs as Registration[]) ?? []}
        revenue={revenue}
        owners={(owners as { id: string; full_name: string | null; email: string | null }[]) ?? []}
      />
    </>
  );
}
