"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";

export type ScanResult = {
  status: "ok" | "already" | "invalid";
  message: string;
  attendeeName?: string | null;
  eventTitle?: string | null;
  eventId?: string | null;
  checkedInAt?: string | null;
};

/**
 * Check one ticket in.
 *
 * All of the judgement lives in check_in_ticket: whether the code exists,
 * whether this person may admit it, whether it has already been used, and the
 * credits and group seeding that follow. Two doors scanning the same ticket at
 * once is settled there too — the second one gets "already", not a duplicate.
 */
export async function scanTicket(code: string, eventId: string): Promise<ScanResult> {
  const user = await getCurrentUser();
  if (!user) return { status: "invalid", message: "Not signed in" };

  const trimmed = (code ?? "").trim();
  if (!trimmed) return { status: "invalid", message: "No code" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("check_in_ticket", { p_code: trimmed });
  if (error) return { status: "invalid", message: error.message };

  const res = data as ScanResult;

  // A valid ticket for a different event is a real mistake at a door running
  // two events in one building, and the generic message hides it.
  if (res.eventId && res.eventId !== eventId) {
    return {
      status: "invalid",
      message: `That ticket is for ${res.eventTitle ?? "another event"}.`,
      attendeeName: res.attendeeName,
    };
  }
  return res;
}
