"use client";

import { useState, useTransition } from "react";
import { toast } from "@/components/Toast";
import type {
  Organisation, PlatformAdmin, TenantAdmin, PlatformStats,
} from "@/lib/os-tenants";
import {
  createOrganisation, renameOrganisation, setOrganisationStatus, switchTenant,
  grantPlatformAdmin, revokePlatformAdmin, assignTenantAdmin, unassignTenantMember,
} from "../actions";

/** The same rule as public.bos_slugify, for previewing the address as you type. */
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-{2,}/g, "-").replace(/^-|-$/g, "");
}

const STATUS_PILL: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  suspended: "bg-amber-50 text-amber-700",
  archived: "bg-surface-2 text-faint",
};

const card = "rounded-2xl border border-line bg-surface shadow-soft";
const field =
  "w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-fg outline-none focus:border-brand";
const label =
  "mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-faint";

export function PlatformClient({
  orgs,
  platformAdmins,
  tenantAdmins,
  stats,
  consoleMigrated,
  me,
}: {
  orgs: Organisation[];
  platformAdmins: PlatformAdmin[];
  tenantAdmins: TenantAdmin[];
  stats: PlatformStats;
  consoleMigrated: boolean;
  me: string;
}) {
  const [saving, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [openOrg, setOpenOrg] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  const preview = slugify(slug || name);
  const adminsFor = (id: string) => tenantAdmins.filter((a) => a.tenant_id === id);

  const run = (fn: () => Promise<{ error?: string } | { success: boolean }>, ok: string) =>
    start(async () => {
      const res = await fn();
      if (res && "error" in res && res.error) toast(res.error, "error");
      else toast(ok, "success");
    });

  return (
    <div>
      <header className="mb-5">
        <h1 className="font-display text-2xl font-bold tracking-tight text-fg">Organisations</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Every business running on this platform. Each has its own people, products and data,
          and nothing crosses between them — including for you. To see inside one, enter it.
        </p>
      </header>

      {!consoleMigrated && (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>Migration 0053 has not run.</strong> The totals and the per-business
          administrator lists come from it. Everything else on this page works.
        </div>
      )}

      {/* ── Totals. The one that matters is businesses with no administrator:
             such a business cannot appoint one itself. ── */}
      {consoleMigrated && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Businesses" value={stats.tenants ?? 0} hint={`${stats.tenants_active ?? 0} active`} />
          <Stat label="People" value={stats.members ?? 0} hint={`${stats.admins ?? 0} admins`} />
          <Stat
            label="Without an admin"
            value={stats.tenants_without_admin ?? 0}
            hint={stats.tenants_without_admin ? "cannot appoint one themselves" : "all covered"}
            alert={(stats.tenants_without_admin ?? 0) > 0}
          />
          <Stat label="Platform admins" value={stats.platform_admins ?? 0} hint="can reach every business" />
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
          {orgs.length} {orgs.length === 1 ? "business" : "businesses"}
        </h2>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90"
          >
            New organisation
          </button>
        )}
      </div>

      {adding && (
        <div className={`${card} mb-4 p-5`}>
          <form
            action={(fd) =>
              start(async () => {
                const res = await createOrganisation(fd);
                if ("error" in res && res.error) return toast(res.error, "error");
                toast(`${fd.get("name")} created. Appoint its administrator next.`, "success");
                setAdding(false);
                setName("");
                setSlug("");
              })
            }
          >
            <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
              New organisation
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className={label}>Name</span>
                <input name="name" value={name} onChange={(e) => setName(e.target.value)}
                       required minLength={2} autoFocus placeholder="Jilo" className={field} />
              </label>
              <label className="block">
                <span className={label}>
                  Address <span className="font-normal normal-case tracking-normal">(optional)</span>
                </span>
                <input name="slug" value={slug} onChange={(e) => setSlug(e.target.value)}
                       placeholder={preview || "jilo"} className={`${field} font-mono text-[13px]`} />
              </label>
            </div>
            <p className="mt-2 text-[11px] text-faint">
              {preview ? (
                <>Identified across the platform as <code className="font-mono text-fg">{preview}</code>. It does not change if the business is renamed.</>
              ) : (
                "The address is built from the name unless you set one."
              )}
            </p>
            <p className="mt-3 rounded-xl border border-line bg-surface-2/50 px-3 py-2 text-[11px] text-muted">
              It starts empty — no people, no events, no money — with the full product catalogue,
              and sees nothing belonging to any other business. You will be its only administrator
              until you appoint one.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <button type="submit" disabled={saving || name.trim().length < 2}
                      className="rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
                {saving ? "Creating…" : "Create"}
              </button>
              <button type="button" onClick={() => setAdding(false)} className="text-xs font-medium text-faint hover:text-fg">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="space-y-3">
        {orgs.map((o) => {
          const admins = adminsFor(o.id);
          const expanded = openOrg === o.id;
          return (
            <div key={o.id} className={card}>
              <div className="flex flex-wrap items-start justify-between gap-3 p-5">
                <div className="min-w-0">
                  {renaming === o.id ? (
                    <div className="flex items-center gap-2">
                      <input value={draftName} onChange={(e) => setDraftName(e.target.value)} autoFocus className={field} />
                      <button type="button" disabled={saving || draftName.trim().length < 2}
                        onClick={() => {
                          run(() => renameOrganisation(o.id, draftName), "Renamed");
                          setRenaming(null);
                        }}
                        className="shrink-0 rounded-full border border-brand px-3 py-1 text-xs font-semibold text-brand disabled:opacity-50">
                        Save
                      </button>
                      <button type="button" onClick={() => setRenaming(null)} className="shrink-0 text-xs text-faint hover:text-fg">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <h3 className="flex flex-wrap items-center gap-2 font-display text-base font-semibold text-fg">
                      {o.name}
                      {o.is_default && (
                        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
                          Main
                        </span>
                      )}
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_PILL[o.status] ?? ""}`}>
                        {o.status}
                      </span>
                      {consoleMigrated && admins.length === 0 && (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                          No admin
                        </span>
                      )}
                    </h3>
                  )}
                  <p className="mt-1 text-xs text-faint">
                    <code className="font-mono text-[11px]">{o.slug}</code>
                    {" · "}{o.member_count} {o.member_count === 1 ? "person" : "people"}
                    {" · "}{o.product_count} products
                    {" · since "}{new Date(o.created_at).toLocaleDateString()}
                  </p>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <button type="button" onClick={() => setOpenOrg(expanded ? null : o.id)}
                    className="rounded-full border border-line px-3 py-1 text-xs font-medium text-muted hover:border-brand hover:text-brand">
                    {expanded ? "Hide" : consoleMigrated ? `Administrators (${admins.length})` : "Details"}
                  </button>
                  {o.status === "active" && (
                    <button type="button" disabled={saving}
                      onClick={() =>
                        start(async () => {
                          const res = await switchTenant(o.id);
                          if (res && "error" in res && res.error) return toast(res.error, "error");
                          window.location.href = "/shreex/dashboard";
                        })
                      }
                      className="rounded-full border border-line px-3 py-1 text-xs font-medium text-muted hover:border-brand hover:text-brand disabled:opacity-50">
                      Enter
                    </button>
                  )}
                  {renaming !== o.id && (
                    <button type="button"
                      onClick={() => { setRenaming(o.id); setDraftName(o.name); }}
                      className="rounded-full border border-line px-3 py-1 text-xs font-medium text-muted hover:border-brand hover:text-brand">
                      Rename
                    </button>
                  )}
                  {!o.is_default && (
                    <button type="button" disabled={saving}
                      onClick={() =>
                        run(
                          () => setOrganisationStatus(o.id, o.status === "active" ? "suspended" : "active"),
                          o.status === "active" ? `${o.name} suspended` : `${o.name} reactivated`,
                        )
                      }
                      className={
                        o.status === "active"
                          ? "text-xs font-medium text-faint hover:text-red-600 disabled:opacity-50"
                          : "rounded-full border border-emerald-300 px-3 py-1 text-xs font-medium text-emerald-700 disabled:opacity-50"
                      }>
                      {o.status === "active" ? "Suspend" : "Reactivate"}
                    </button>
                  )}
                </div>
              </div>

              {expanded && (
                <OrgAdmins
                  org={o}
                  admins={admins}
                  migrated={consoleMigrated}
                  saving={saving}
                  start={start}
                />
              )}
            </div>
          );
        })}
      </div>

      <PlatformAdmins admins={platformAdmins} me={me} saving={saving} start={start} />
    </div>
  );
}

function Stat({
  label: l, value, hint, alert = false,
}: { label: string; value: number; hint?: string; alert?: boolean }) {
  return (
    <div className={`${card} px-4 py-3`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">{l}</p>
      <p className={`mt-0.5 font-display text-2xl font-bold ${alert ? "text-amber-600" : "text-fg"}`}>{value}</p>
      {hint && <p className="mt-0.5 truncate text-[11px] text-faint">{hint}</p>}
    </div>
  );
}

/**
 * Who administers one business, and the control that hands it over.
 *
 * This is the piece that made 0053 necessary. A business created here has the
 * platform owner as its only admin, and it cannot appoint another from inside
 * itself — so handing it over had to become a platform act. It is logged in
 * the business that gained the administrator.
 */
function OrgAdmins({
  org,
  admins,
  migrated,
  saving,
  start,
}: {
  org: Organisation;
  admins: TenantAdmin[];
  migrated: boolean;
  saving: boolean;
  start: (fn: () => Promise<void>) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("admin");

  return (
    <div className="border-t border-line bg-surface-2/40 px-5 py-4">
      {!migrated ? (
        <p className="text-xs text-muted">
          Run migration <span className="font-mono">0053_platform_console.sql</span> to see and
          appoint the administrators of each business from here.
        </p>
      ) : (
        <>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
            Administrators of {org.name}
          </p>

          {admins.length === 0 ? (
            <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Nobody administers this business. It cannot appoint an administrator itself — only you
              can, from here.
            </p>
          ) : (
            <ul className="mb-3 divide-y divide-line rounded-xl border border-line bg-surface">
              {admins.map((a) => (
                <li key={a.user_id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-fg">
                      {a.full_name || a.email}
                    </span>
                    <span className="block truncate text-[11px] text-faint">
                      {a.email} · since {new Date(a.joined_at).toLocaleDateString()}
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={saving || admins.length <= 1}
                    title={admins.length <= 1 ? "The last administrator cannot be removed — the business cannot appoint a replacement itself." : undefined}
                    onClick={() =>
                      start(async () => {
                        const res = await unassignTenantMember(org.id, a.user_id);
                        if ("error" in res && res.error) return toast(res.error, "error");
                        toast(`Removed from ${org.name}`, "success");
                      })
                    }
                    className="shrink-0 text-xs font-medium text-faint hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form
            action={(fd) =>
              start(async () => {
                const res = await assignTenantAdmin(fd);
                if ("error" in res && res.error) return toast(res.error, "error");
                toast(`Appointed to ${org.name}`, "success");
                setEmail("");
              })
            }
            className="flex flex-wrap items-end gap-2"
          >
            <input type="hidden" name="tenantId" value={org.id} />
            <label className="min-w-[14rem] flex-1">
              <span className={label}>Appoint by email</span>
              <input name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                     placeholder="them@example.com" className={field} />
            </label>
            <label className="w-40">
              <span className={label}>As</span>
              <select name="role" value={role} onChange={(e) => setRole(e.target.value)} className={field}>
                <option value="admin">Admin</option>
                <option value="employee">Employee</option>
                <option value="event_host">Event host</option>
              </select>
            </label>
            <button type="submit" disabled={saving || !email.includes("@")}
                    className="rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
              {saving ? "Appointing…" : "Appoint"}
            </button>
          </form>
          <p className="mt-2 text-[11px] text-faint">
            The account has to exist already — this appoints somebody, it does not invite them. For
            an address with no account, enter the business and send an invitation instead.
            Appointing is written to {org.name} audit log.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Who runs the platform.
 *
 * Support is listed beside super admin deliberately: a list showing only
 * permanent authority would hide exactly the access worth reviewing.
 */
function PlatformAdmins({
  admins,
  me,
  saving,
  start,
}: {
  admins: PlatformAdmin[];
  me: string;
  saving: boolean;
  start: (fn: () => Promise<void>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("super_admin");
  const supers = admins.filter((a) => a.role === "super_admin" && !a.is_expired).length;

  return (
    <div className="mt-8">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
          Platform administrators ({admins.length})
        </h2>
        <button type="button" onClick={() => setOpen((o) => !o)}
          className="rounded-full border border-line px-3 py-1 text-xs font-medium text-muted hover:border-brand hover:text-brand">
          {open ? "Cancel" : "+ Appoint"}
        </button>
      </div>

      {open && (
        <div className={`${card} mb-3 p-5`}>
          <form
            action={(fd) =>
              start(async () => {
                const res = await grantPlatformAdmin(fd);
                if ("error" in res && res.error) return toast(res.error, "error");
                toast("Appointed", "success");
                setOpen(false);
                setEmail("");
              })
            }
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block sm:col-span-2">
                <span className={label}>Email of an existing account</span>
                <input name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                       required autoFocus placeholder="them@example.com" className={field} />
              </label>
              <label className="block">
                <span className={label}>As</span>
                <select name="role" value={role} onChange={(e) => setRole(e.target.value)} className={field}>
                  <option value="super_admin">Super admin</option>
                  <option value="support">Support (temporary)</option>
                </select>
              </label>
            </div>
            {role === "support" && (
              <label className="mt-3 block max-w-[12rem]">
                <span className={label}>Ends after</span>
                <select name="days" defaultValue="7" className={field}>
                  <option value="1">1 day</option>
                  <option value="7">7 days</option>
                  <option value="30">30 days</option>
                </select>
              </label>
            )}
            <p className="mt-3 rounded-xl border border-line bg-surface-2/50 px-3 py-2 text-[11px] text-muted">
              {role === "super_admin"
                ? "A super admin may enter every business and create new ones. Entering one they do not belong to is written to that business audit log."
                : "Support access must end. It does not make somebody a super admin — it is the seat time-boxed internal access will use."}
            </p>
            <button type="submit" disabled={saving || !email.includes("@")}
                    className="mt-3 rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
              {saving ? "Appointing…" : "Appoint"}
            </button>
          </form>
        </div>
      )}

      <div className={`${card} p-0`}>
        <div className="divide-y divide-line">
          {admins.map((a) => (
            <div key={a.user_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
                  {a.full_name || a.email || a.user_id}
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    a.role === "super_admin" ? "bg-brand/10 text-brand-soft" : "bg-surface-2 text-faint"}`}>
                    {a.role === "super_admin" ? "Super admin" : "Support"}
                  </span>
                  {a.is_expired && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                      Expired
                    </span>
                  )}
                  {a.user_id === me && (
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
                      You
                    </span>
                  )}
                </p>
                <p className="mt-0.5 truncate text-xs text-faint">
                  {a.email}
                  {a.granted_by_email && ` · appointed by ${a.granted_by_email}`}
                  {a.expires_at
                    ? ` · ${a.is_expired ? "ended" : "ends"} ${new Date(a.expires_at).toLocaleDateString()}`
                    : " · does not expire"}
                </p>
              </div>
              <button type="button"
                disabled={saving || (a.role === "super_admin" && supers <= 1 && !a.is_expired)}
                title={a.role === "super_admin" && supers <= 1 && !a.is_expired
                  ? "The last platform administrator cannot be removed — nobody else can appoint one."
                  : undefined}
                onClick={() =>
                  start(async () => {
                    const res = await revokePlatformAdmin(a.user_id);
                    if ("error" in res && res.error) return toast(res.error, "error");
                    toast("Removed", "success");
                  })
                }
                className="shrink-0 text-xs font-medium text-faint hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40">
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-2 max-w-2xl text-xs text-muted">
        Platform authority is a row here, not a membership in any business — which is why removing
        the last one is refused: nobody else is able to appoint a replacement.
      </p>
    </div>
  );
}
