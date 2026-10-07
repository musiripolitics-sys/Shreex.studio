import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/os/ui";
import { requireSection, scopeToMe } from "@/lib/os-access";

export const metadata = { title: "Calendar · Shreex" };

import { CalendarView, type CalItem } from "./CalendarView";


export default async function CalendarPage() {
  await requireSection("plan");
  // An employee's calendar is their own dates. The company-wide entries —
  // campaigns, content, hiring, legal renewals — belong to whoever owns them.
  const mine = await scopeToMe();
  const supabase = await createClient();

  const [
    { data: events },
    { data: content },
    { data: campaigns },
    { data: tasks },
    { data: goals },
    { data: legal },
    { data: hiring },
    { data: podcast },
  ] = await Promise.all([
    supabase.from("events").select("id,title,slug,date").order("date"),
    mine ? Promise.resolve({ data: [] }) : supabase.from("content_items").select("id,topic,content_date"),
    mine ? Promise.resolve({ data: [] }) : supabase.from("campaigns").select("id,name,start_date"),
    mine
      ? supabase.from("tasks").select("id,title,due_date,status,completed_at").eq("owner_id", mine)
      : supabase.from("tasks").select("id,title,due_date,status,completed_at"),
    mine
      ? supabase.from("goals").select("id,objective,end_date").eq("owner_id", mine)
      : supabase.from("goals").select("id,objective,end_date"),
    mine ? Promise.resolve({ data: [] }) : supabase.from("legal_items").select("id,requirement,due_date,expiry_date"),
    mine ? Promise.resolve({ data: [] }) : supabase.from("hiring_plan").select("id,role,target_month"),
    mine ? Promise.resolve({ data: [] }) : supabase.from("podcast_episodes").select("id,title,recording_date"),
  ]);

  const items: CalItem[] = [];
  const push = (date: string | null, type: string, label: string, href: string) => {
    if (date) items.push({ date: date.slice(0, 10), type, label, href });
  };

  for (const e of events ?? []) push(e.date, "Event", e.title, `/events/${e.slug}`);
  for (const c of content ?? []) push(c.content_date, "Content", c.topic ?? "Content", "/shreex/content");
  for (const c of campaigns ?? []) push(c.start_date, "Campaign", c.name, "/shreex/campaigns");
  // Tasks appear twice over their life: on the day they are due, and again on
  // the day they were actually finished. Seeing both is the point — the gap
  // between them is what the calendar is for.
  const todayIso = new Date().toISOString().slice(0, 10);
  for (const x of tasks ?? []) {
    if (x.status === "cancelled") continue;
    if (x.status === "completed") {
      push(x.completed_at ?? null, "Task done", x.title, "/shreex/tasks");
      continue;
    }
    const overdue = !!x.due_date && x.due_date.slice(0, 10) < todayIso;
    push(
      x.due_date,
      overdue ? "Task overdue" : "Task due",
      x.title,
      overdue ? "/shreex/tasks?view=overdue" : "/shreex/tasks",
    );
  }
  for (const g of goals ?? []) push(g.end_date, "Goal", g.objective, "/shreex/roadmap");
  for (const l of legal ?? []) { push(l.due_date, "Legal due", l.requirement, "/shreex/legal"); push(l.expiry_date, "Legal expiry", `${l.requirement} expires`, "/shreex/legal"); }
  for (const h of hiring ?? []) push(h.target_month, "Hiring", h.role, "/shreex/hiring");
  for (const p of podcast ?? []) push(p.recording_date, "Podcast", p.title, "/shreex/podcast");

  items.sort((a, b) => a.date.localeCompare(b.date));
  const months = [...new Set(items.map((i) => i.date.slice(0, 7)))].sort();

  return (
    <>
      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold tracking-tight text-fg">Business Calendar</h1>
        <p className="text-sm text-muted">
          Every dated record in the OS on one grid — tasks due and done, goals, events,
          content, campaigns, hiring and renewals. Click a day to see everything on it.
        </p>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="Nothing scheduled yet"
          hint="Dated records across the OS show up here automatically."
        />
      ) : (
        <CalendarView items={items} months={months} />
      )}
    </>
  );
}
