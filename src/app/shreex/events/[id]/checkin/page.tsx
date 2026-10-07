import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireSection } from "@/lib/os-access";
import { CheckinScanner, type DoorRegistration } from "./CheckinScanner";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("events").select("title").eq("id", id).maybeSingle();
  return { title: `Door · ${(data as { title?: string } | null)?.title ?? "Event"}` };
}

/**
 * The door.
 *
 * The whole attendee list is sent to the browser on purpose. A venue with two
 * hundred people on the same wifi is exactly where the network gives out, and
 * a check-in screen that needs a round trip to tell you whether a code is real
 * is no use at that moment. With the list in hand the scanner can answer
 * immediately and reconcile with the server afterwards.
 */
export default async function CheckinPage({ params }: { params: Params }) {
  await requireSection("events");
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: event }, { data: regs }] = await Promise.all([
    supabase.from("events").select("id,title,date,venue,city,capacity").eq("id", id).maybeSingle(),
    supabase
      .from("registrations")
      .select("id,attendee_name,attendee_email,ticket_code,status,checked_in_at")
      .eq("event_id", id)
      .in("status", ["registered", "attended"])
      .order("attendee_name"),
  ]);

  if (!event) notFound();

  return (
    <>
      <Link
        href={`/shreex/events/${id}`}
        className="mb-3 inline-block text-xs font-medium text-muted hover:text-brand"
      >
        ← {(event as { title: string }).title}
      </Link>
      <CheckinScanner
        event={event as { id: string; title: string; date: string; venue: string | null; city: string; capacity: number }}
        initial={(regs as DoorRegistration[]) ?? []}
      />
    </>
  );
}
