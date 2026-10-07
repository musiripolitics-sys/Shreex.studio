import { createClient } from "@/lib/supabase/server";
import { Card, EmptyState, KpiCard } from "@/components/os/ui";
import { inr, num, shortDate } from "@/lib/bos";
import { requireSection } from "@/lib/os-access";
import { loadDirectory } from "@/lib/os-directory";
import { loadMyTenants } from "@/lib/os-tenants";
import { HostPipeline, type HostRequest, type HostMessage, type Template } from "./HostPipeline";

export const metadata = { title: "Hosts · Shreex" };

export default async function HostsPage() {
  await requireSection("events");
  const supabase = await createClient();
  // Signs the outgoing host emails. The template placeholder used to be filled
  // with a hardcoded "the Techxfluence team", which signed a Jilo
  // administrator email as somebody else company.
  const tenants = await loadMyTenants();
  const businessName = tenants.find((t) => t.is_active)?.name ?? tenants[0]?.name;

  const [
    { data: hosts },
    { data: submissions },
    { data: events },
    { data: earnings },
    { data: requests },
    { data: messages },
    { data: templates },
    { data: eventOptions },
    directory,
  ] = await Promise.all([
    supabase.from("users").select("id,full_name,email,host_status,created_at").eq("primary_role", "event_host").order("full_name"),
    supabase.from("host_submissions").select("organizer_id,status"),
    supabase.from("events").select("host_id,status"),
    supabase.rpc("get_all_host_earnings"),
    // The pipeline. Ordered oldest-first within a stage so the thing that has
    // been waiting longest is the first card you see.
    supabase
      .from("host_submissions")
      .select("id,title,category,date,city,venue,description,organizer_email,organizer_id,status,stage,owner_id,event_id,next_step,next_step_on,stage_changed_at,submitted_at")
      .order("submitted_at", { ascending: true }),
    supabase
      .from("host_messages")
      .select("id,submission_id,author_id,kind,subject,body,to_email,created_at")
      .order("created_at", { ascending: true }),
    supabase
      .from("email_templates")
      .select("id,name,purpose,subject,body,stage")
      .eq("is_active", true)
      .order("sort_order"),
    supabase.from("events").select("id,title,date").order("date", { ascending: false }).limit(200),
    loadDirectory(supabase),
  ]);

  const proposed = new Map<string, number>();
  for (const s of submissions ?? []) if (s.organizer_id) proposed.set(s.organizer_id, (proposed.get(s.organizer_id) ?? 0) + 1);

  const created = new Map<string, number>();
  const completed = new Map<string, number>();
  for (const e of events ?? []) {
    if (!e.host_id) continue;
    created.set(e.host_id, (created.get(e.host_id) ?? 0) + 1);
    if (e.status === "completed") completed.set(e.host_id, (completed.get(e.host_id) ?? 0) + 1);
  }

  const gross = new Map<string, number>();
  for (const r of (earnings as { host_id: string; gross: number }[]) ?? []) gross.set(r.host_id, Number(r.gross ?? 0));

  const rows = (hosts ?? []).map((h) => ({
    ...h,
    proposed: proposed.get(h.id) ?? 0,
    created: created.get(h.id) ?? 0,
    completed: completed.get(h.id) ?? 0,
    revenue: gross.get(h.id) ?? 0,
  }));

  const totalRevenue = rows.reduce((a, r) => a + r.revenue, 0);

  // A proposal carries an email but not a name; the name is on the account
  // when the proposer was signed in.
  const nameOf = (id: string | null) => directory.find((d) => d.id === id)?.full_name ?? null;

  const pipeline: HostRequest[] = ((requests as Record<string, unknown>[]) ?? []).map((r) => ({
    ...(r as unknown as HostRequest),
    organizer_name: nameOf((r.organizer_id as string) ?? null),
  }));

  const thread: HostMessage[] = ((messages as Record<string, unknown>[]) ?? []).map((m) => ({
    ...(m as unknown as HostMessage),
    author_name: nameOf((m.author_id as string) ?? null),
  }));

  const openRequests = pipeline.filter((r) => r.stage !== "done" && r.stage !== "declined").length;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg">Hosts</h1>
          <p className="max-w-3xl text-sm text-muted">
            Every proposal from the Host an event form, worked from left to right, with the whole
            conversation kept against it. Below that, the hosts who have run something for us.
          </p>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Active hosts" value={num(rows.length)} />
        <KpiCard label="Open requests" value={num(openRequests)} tone={openRequests ? "warn" : "default"} />
        <KpiCard label="Events completed" value={num(rows.reduce((a, r) => a + r.completed, 0))} />
        <KpiCard label="Host revenue (gross)" value={inr(totalRevenue)} tone="good" />
      </div>

      <section className="mb-8">
        <h2 className="mb-2 font-display text-sm font-bold uppercase tracking-wider text-faint">
          Requests
        </h2>
        <HostPipeline
          requests={pipeline}
          messages={thread}
          templates={(templates as Template[]) ?? []}
          owners={directory}
          events={(eventOptions as { id: string; title: string; date: string }[]) ?? []}
          businessName={businessName}
        />
      </section>

      <h2 className="mb-2 font-display text-sm font-bold uppercase tracking-wider text-faint">
        Hosts
      </h2>
      {rows.length === 0 ? (
        <EmptyState title="No hosts yet" hint="Somebody becomes a host once they have run an event." />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-faint">
                <th className="px-4 py-3 font-semibold">Host</th>
                <th className="px-3 py-3 font-semibold">Status</th>
                <th className="px-3 py-3 font-semibold">Since</th>
                <th className="px-3 py-3 text-right font-semibold">Proposed</th>
                <th className="px-3 py-3 text-right font-semibold">Created</th>
                <th className="px-3 py-3 text-right font-semibold">Completed</th>
                <th className="px-3 py-3 text-right font-semibold">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.id} className="border-b border-line/60 last:border-0 hover:bg-surface-2">
                  <td className="px-4 py-3">
                    <p className="font-medium text-fg">{h.full_name || "—"}</p>
                    <p className="text-xs text-muted">{h.email}</p>
                  </td>
                  <td className="px-3 py-3">
                    <span className="rounded-full bg-ink-2 px-2 py-0.5 text-xs capitalize text-muted">{h.host_status}</span>
                  </td>
                  <td className="px-3 py-3 text-xs text-muted">{shortDate(h.created_at)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-muted">{h.proposed}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-muted">{h.created}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-muted">{h.completed}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-green-600">{inr(h.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
