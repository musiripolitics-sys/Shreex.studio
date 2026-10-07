import { createClient } from "@/lib/supabase/server";
import { KpiCard, SectionHeading } from "@/components/os/ui";
import { BarList, type BarDatum } from "@/components/os/BarList";
import { num, inrCompact, pct } from "@/lib/bos";
import { requireSection } from "@/lib/os-access";

export const metadata = { title: "Membership · Shreex" };

export default async function MembershipPage() {
  await requireSection("grow");
  const supabase = await createClient();
  const [{ data: memberships }, { data: payments }] = await Promise.all([
    supabase.from("memberships").select("tier,status,started_at,source"),
    supabase.from("payments").select("amount,created_at,stream,status").eq("stream", "membership").eq("status", "paid"),
  ]);

  const M = memberships ?? [];
  const active = M.filter((m) => m.status === "active");
  const tier = (t: string) => active.filter((m) => m.tier === t).length;
  const cm = new Date().toISOString().slice(0, 7);
  const newThisMonth = M.filter((m) => (m.started_at ?? "").slice(0, 7) === cm).length;

  const revenue = (payments ?? []).reduce((a, p) => a + (p.amount ?? 0), 0);

  // Conversion / retention / churn
  const conversion = active.length ? (active.filter((m) => m.tier !== "Free").length / active.length) * 100 : 0;
  const retention = M.length ? (active.length / M.length) * 100 : 0;
  const churn = M.length ? (M.filter((m) => m.status === "cancelled" || m.status === "expired").length / M.length) * 100 : 0;

  // By acquisition source
  const bySource = new Map<string, number>();
  for (const m of M) {
    const src = m.source || "Unattributed";
    bySource.set(src, (bySource.get(src) ?? 0) + 1);
  }
  const sourceBars: BarDatum[] = [...bySource.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));

  // New members by month
  const byMonth = new Map<string, number>();
  for (const m of M) {
    const k = (m.started_at ?? "").slice(0, 7);
    if (k) byMonth.set(k, (byMonth.get(k) ?? 0) + 1);
  }
  const trend: BarDatum[] = [...byMonth.entries()].sort().slice(-12).map(([label, value]) => ({ label, value }));

  const tiers: BarDatum[] = [
    { label: "Free", value: tier("Free") },
    { label: "Paid (Pro)", value: tier("Pro") },
    { label: "Elite", value: tier("Elite") },
  ];

  const statuses: BarDatum[] = ["active", "cancelled", "expired", "past_due"].map((s) => ({
    label: s,
    value: M.filter((m) => m.status === s).length,
  }));

  return (
    <>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-fg">Membership</h1>
        <p className="text-sm text-muted">Free, Paid and Elite tiers — counts, trend and revenue from live data.</p>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Total active" value={num(active.length)} tone="brand" />
        <KpiCard label="Free" value={num(tier("Free"))} />
        <KpiCard label="Paid" value={num(tier("Pro"))} />
        <KpiCard label="Elite" value={num(tier("Elite"))} />
        <KpiCard label="New this month" value={num(newThisMonth)} tone="good" />
        <KpiCard label="Membership revenue" value={inrCompact(revenue)} tone="good" />
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-3">
        <KpiCard label="Conversion (paid+elite)" value={pct(conversion)} tone="brand" />
        <KpiCard label="Retention" value={pct(retention)} tone={retention >= 70 ? "good" : "warn"} />
        <KpiCard label="Churn" value={pct(churn)} tone={churn > 20 ? "bad" : "default"} />
      </div>

      <SectionHeading title="Trends & sources" />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <BarList title="New members by month" data={trend} emptyHint="Signups will appear here." />
        <BarList title="By tier (active)" data={tiers} color="#10b981" />
        <BarList title="By status" data={statuses} color="#64748b" />
        <BarList title="By acquisition source" data={sourceBars} color="#ec4899" emptyHint="Set a source on memberships to attribute." />
      </div>

      <p className="mt-6 text-xs text-faint">
        Acquisition source reads the new memberships.source column (events, ambassadors, referrals,
        social, paid…). Set it when a membership is created to power source attribution.
      </p>
    </>
  );
}
