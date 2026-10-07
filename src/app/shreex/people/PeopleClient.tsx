"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "@/components/Toast";
import { Card, KpiCard, EmptyState } from "@/components/os/ui";
import { Modal, Field, Input, Select, FormActions } from "@/components/os/Modal";
import { inr, inrCompact, shortDate, rupeesToPaise, paiseToRupees } from "@/lib/bos";
import { saveProfile } from "@/lib/team-actions";

export type Member = {
  id: string; full_name: string | null; email: string | null; role: string | null;
  title: string | null; department: string | null; manager_id: string | null;
  start_date: string | null; monthly_cost: number; status: string | null;
  sections: string[]; openTasks: number; overdueTasks: number;
  kpiCount: number; kpiMeasured: number;
};

const ROLE_TONE: Record<string, string> = {
  admin: "bg-brand/10 text-brand-soft",
  employee: "bg-blue-100 text-blue-700",
  event_host: "bg-amber-100 text-amber-700",
};

/**
 * Who is on the team and what they are carrying.
 *
 * The register this replaced listed titles. The thing a manager opens this
 * for is who is overloaded, who has access to nothing, and who has no
 * profile at all — so those are what the cards lead with.
 */
export function PeopleClient({ members }: { members: Member[] }) {
  const [editing, setEditing] = useState<Member | null>(null);
  const [q, setQ] = useState("");

  const staff = members.filter((m) => m.role === "admin" || m.role === "employee" || m.role === "event_host");

  const stats = useMemo(() => ({
    total: staff.length,
    noProfile: staff.filter((m) => !m.title && !m.department).length,
    noAccess: staff.filter((m) => m.role === "employee" && m.sections.length === 0).length,
    cost: staff.reduce((a, m) => a + (m.monthly_cost ?? 0), 0),
  }), [staff]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return staff;
    return staff.filter((m) =>
      [m.full_name, m.email, m.title, m.department].some((v) => (v ?? "").toLowerCase().includes(needle)));
  }, [staff, q]);

  const byDept = useMemo(() => {
    const g = new Map<string, Member[]>();
    for (const m of shown) {
      const k = m.department || "No department";
      if (!g.has(k)) g.set(k, []);
      g.get(k)!.push(m);
    }
    return [...g.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [shown]);

  const nameOf = (id: string | null) => members.find((m) => m.id === id)?.full_name ?? null;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg">People</h1>
          <p className="max-w-3xl text-sm text-muted">
            Who is on the team, what they can open, and what they are carrying right now.
          </p>
        </div>
        <Link href="/shreex/team/access"
          className="shrink-0 rounded-full border border-line px-4 py-2 text-sm font-medium text-fg hover:border-brand hover:text-brand">
          Manage access
        </Link>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="On the team" value={String(stats.total)} />
        <KpiCard label="No profile filled in" value={String(stats.noProfile)} tone={stats.noProfile ? "warn" : "good"} />
        <KpiCard label="Employees with no access" value={String(stats.noAccess)} tone={stats.noAccess ? "warn" : "good"} />
        <KpiCard label="Monthly cost" value={inrCompact(stats.cost)}
          sub={stats.cost === 0 ? "nothing recorded yet" : inr(stats.cost)} />
      </div>

      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email, title or department…"
        className="mb-4 w-full max-w-sm rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-fg outline-none focus:border-brand" />

      {shown.length === 0 ? (
        <EmptyState title="Nobody here" hint="Employees onboarded in the OS appear here." />
      ) : (
        <div className="space-y-5">
          {byDept.map(([dept, list]) => (
            <section key={dept}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-faint">
                {dept} <span className="font-normal">· {list.length}</span>
              </h2>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {list.map((m) => (
                  <Card key={m.id} className="!p-0">
                    <div className="border-b border-line px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <button onClick={() => setEditing(m)} className="font-medium text-fg hover:text-brand hover:underline">
                            {m.full_name || m.email}
                          </button>
                          <p className="truncate text-xs text-muted">{m.title || "No title recorded"}</p>
                        </div>
                        {m.role && (
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${ROLE_TONE[m.role] ?? "bg-surface-2 text-muted"}`}>
                            {m.role === "event_host" ? "host" : m.role}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[11px] text-faint">
                        {m.start_date ? `Since ${shortDate(m.start_date)}` : "No start date"}
                        {nameOf(m.manager_id) ? ` · reports to ${nameOf(m.manager_id)}` : ""}
                        {m.monthly_cost > 0 ? ` · ${inrCompact(m.monthly_cost)}/mo` : ""}
                      </p>
                    </div>

                    <div className="grid grid-cols-3 divide-x divide-line border-b border-line text-center">
                      <div className="px-2 py-2">
                        <p className="font-display text-base font-bold tabular-nums text-fg">{m.openTasks}</p>
                        <p className="text-[10px] uppercase tracking-wider text-faint">open</p>
                      </div>
                      <div className="px-2 py-2">
                        <p className={`font-display text-base font-bold tabular-nums ${m.overdueTasks ? "text-red-600" : "text-fg"}`}>
                          {m.overdueTasks}
                        </p>
                        <p className="text-[10px] uppercase tracking-wider text-faint">late</p>
                      </div>
                      <div className="px-2 py-2">
                        <p className="font-display text-base font-bold tabular-nums text-fg">
                          {m.kpiCount ? `${m.kpiMeasured}/${m.kpiCount}` : "—"}
                        </p>
                        <p className="text-[10px] uppercase tracking-wider text-faint">KPIs in</p>
                      </div>
                    </div>

                    <div className="px-4 py-2.5">
                      {m.role === "admin" ? (
                        <p className="text-[11px] text-muted">Every section, as an admin.</p>
                      ) : m.sections.length === 0 ? (
                        <Link href="/shreex/team/access" className="text-[11px] font-medium text-amber-700 hover:underline">
                          No sections granted — they can sign in and see nothing
                        </Link>
                      ) : (
                        <p className="text-[11px] text-muted">{m.sections.join(" · ")}</p>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <ProfileForm open={!!editing} member={editing} members={staff} onClose={() => setEditing(null)} />
    </>
  );
}

function ProfileForm({
  open, member, members, onClose,
}: { open: boolean; member: Member | null; members: Member[]; onClose: () => void }) {
  const [saving, start] = useTransition();
  const [form, setForm] = useState(() => ({
    title: member?.title ?? "", department: member?.department ?? "",
    manager_id: member?.manager_id ?? "", start_date: member?.start_date?.slice(0, 10) ?? "",
    costR: member?.monthly_cost ? String(paiseToRupees(member.monthly_cost)) : "",
    status: member?.status ?? "active",
  }));
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  if (!member) return null;

  return (
    <Modal open={open} onClose={onClose} title={member.full_name || "Profile"}>
      <form onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await saveProfile({
            ...form,
            user_id: member.id,
            monthly_cost: rupeesToPaise(Number(form.costR) || 0),
          });
          if ("error" in res && res.error) toast(res.error, "error");
          else { toast("Saved", "success"); onClose(); }
        });
      }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title"><Input value={form.title} onChange={(e) => set("title", e.target.value)} /></Field>
          <Field label="Department"><Input value={form.department} onChange={(e) => set("department", e.target.value)} /></Field>
          <Field label="Reports to">
            <Select value={form.manager_id} onChange={(e) => set("manager_id", e.target.value)}>
              <option value="">Nobody</option>
              {members.filter((m) => m.id !== member.id).map((m) =>
                <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
            </Select>
          </Field>
          <Field label="Started"><Input type="date" value={form.start_date} onChange={(e) => set("start_date", e.target.value)} /></Field>
          <Field label="Monthly cost (₹)"><Input type="number" min={0} value={form.costR} onChange={(e) => set("costR", e.target.value)} /></Field>
          <Field label="Status">
            <Select value={form.status} onChange={(e) => set("status", e.target.value)}>
              {["active", "on_leave", "ended"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
            </Select>
          </Field>
        </div>
        <p className="mt-3 text-xs text-faint">
          Access to sections is granted separately, under Manage access — a profile records who
          somebody is, not what they may open.
        </p>
        <FormActions onCancel={onClose} saving={saving} submitLabel="Save" />
      </form>
    </Modal>
  );
}
