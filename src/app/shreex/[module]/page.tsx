import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MODULES } from "@/lib/os-modules";
import { ModuleTable, type RefOptions } from "@/components/os/ModuleTable";
import { requireSection, sectionForPath, scopeToMe } from "@/lib/os-access";
import { loadDirectory } from "@/lib/os-directory";

type Params = Promise<{ module: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { module } = await params;
  const cfg = MODULES[module];
  return { title: cfg ? `${cfg.title} · Shreex` : "Shreex" };
}

export default async function ModulePage({ params }: { params: Params }) {
  const { module } = await params;
  const config = MODULES[module];
  if (!config) notFound();

  // This one route serves 23 modules, so the section is resolved from the
  // path against the nav rather than listed a second time here.
  const section = sectionForPath(`/shreex/${module}`);
  if (section) await requireSection(section);

  const supabase = await createClient();
  const refs = config.refs ?? [];

  // Registry modules that carry an owner are scoped to the signed-in employee;
  // admins see everything. Dependencies has no owner column, so it is narrowed
  // afterwards to the edges that touch their tasks.
  const mine = await scopeToMe();
  const OWNED = new Set([
    "tasks", "goals", "risks", "legal_items", "sops", "assets",
    "leads", "partnerships", "influencers", "ambassadors", "campaigns",
    "content_items", "app_modules", "hiring_plan", "vendors",
  ]);
  const scoped = mine && OWNED.has(config.table);

  const [{ data: rows }, owners, workstreams, events, goals, campaigns] = await Promise.all([
    (scoped
      ? supabase.from(config.table).select("*").eq("owner_id", mine)
      : supabase.from(config.table).select("*")
    ).order(config.order?.col ?? "created_at", { ascending: config.order?.asc ?? false, nullsFirst: false }),
    // Always load users (owners) — needed by nearly every module. Through the
    // directory, because a direct select on users returns only the caller's own
    // row to an employee, leaving every owner column blank.
    loadDirectory(supabase, { staffOnly: false }),
    refs.includes("workstream")
      ? supabase.from("workstreams").select("id,name,color").order("sort_order")
      : Promise.resolve({ data: [] }),
    refs.includes("event")
      ? supabase.from("events").select("id,title").order("date", { ascending: false }).limit(300)
      : Promise.resolve({ data: [] }),
    refs.includes("goal")
      ? supabase.from("goals").select("id,objective").order("created_at")
      : Promise.resolve({ data: [] }),
    refs.includes("campaign")
      ? supabase.from("campaigns").select("id,name").order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  // workstreams are also used to render workstream columns, so load them when a
  // column needs them even if no field does.
  let ws = (workstreams.data as RefOptions["workstreams"]) ?? [];
  if (ws.length === 0 && config.columns.some((c) => c.type === "workstream")) {
    const { data } = await supabase.from("workstreams").select("id,name,color").order("sort_order");
    ws = (data as RefOptions["workstreams"]) ?? [];
  }

  const options: RefOptions = {
    owners: owners as RefOptions["owners"],
    workstreams: ws,
    events: (events.data as RefOptions["events"]) ?? [],
    goals: (goals.data as RefOptions["goals"]) ?? [],
    campaigns: (campaigns.data as RefOptions["campaigns"]) ?? [],
  };

  // Dependencies are edges, not owned records, so they are filtered by whether
  // either end is one of this employee's tasks.
  let visibleRows = (rows as Record<string, unknown>[]) ?? [];
  if (mine && config.table === "dependencies") {
    const { data: myTasks } = await supabase.from("tasks").select("id").eq("owner_id", mine);
    const ids = new Set(((myTasks as { id: string }[]) ?? []).map((t) => t.id));
    visibleRows = visibleRows.filter(
      (r) => ids.has(String(r.from_id ?? "")) || ids.has(String(r.to_id ?? "")),
    );
  }

  return (
    <ModuleTable
      config={config}
      rows={visibleRows as (Record<string, unknown> & { id: string })[]}
      options={options}
    />
  );
}
