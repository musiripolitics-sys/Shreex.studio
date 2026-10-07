"use client";

import { useState, useTransition } from "react";
import { toast } from "@/components/Toast";
import type {
  Organisation, PlatformAdmin, TenantAdmin, PlatformStats,
} from "@/lib/os-tenants";
import { PageHead, StatStrip, Stat as DenseStat } from "@/components/os/dense";
import { shortDate } from "@/lib/bos";
import {
  createOrganisation, renameOrganisation, setOrganisationStatus, switchTenant,
  grantPlatformAdmin, revokePlatformAdmin, assignTenantAdmin, unassignTenantMember,
  inviteToTenantById,
} from "@/app/shreex/actions";

/** The same rule as public.bos_slugify, for previewing the address as you type. */
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-{2,}/g, "-").replace(/^-|-$/g, "");
}

const STATUS_PILL: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  suspended: "bg-amber-50 text-amber-700",
  archived: "bg-surface-2 text-faint",
};

// Dense surfaces: 8px radius, hairline border, no shadow. A shadow on every
// panel is depth spent on nothing, and it is most of what made this page feel
// heavy next to the rebuilt dashboard.
const card = "rounded-lg border border-line bg-surface";
const field =
  "w-full rounded border border-line bg-surface px-2 py-1 text-[13px] text-fg outline-none focus:border-brand";
const label =
  "mb-1 block text-[11px] font-medium uppercase tracking-[0.08em] text-faint";

export function PlatformClient({
  orgs,
  platformAdmins,
  tenantAdmins,
  stats,
  consoleMigrated,
  me,
  products = [],
}: {
  orgs: Organisation[];
  platformAdmins: PlatformAdmin[];
  tenantAdmins: TenantAdmin[];
  stats: PlatformStats;
  consoleMigrated: boolean;
  me: string;
  /** The catalogue, so a new business can be given only what it needs. */
  products?: { key: string; name: string }[];
}) {
  const [saving, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [picked, setPicked] = useState<string[]>(products.map((p) => p.key));
  const [created, setCreated] = useState<{ name: string; admin: string | null; token: string | null } | null>(null);
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
      <PageHead
        title="Organisations"
        context={`${orgs.length} on this platform · nothing crosses between them, including for you`}
      />

      {!consoleMigrated && (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>Migration 0053 has not run.</strong> The totals and the per-business
          administrator lists come from it. Everything else on this page works.
        </div>
      )}

      {/* ── Totals. The one that matters is businesses with no administrator:
             such a business cannot appoint one itself. ── */}
      {consoleMigrated && (
        <StatStrip>
          <DenseStat label="Businesses" value={stats.tenants ?? 0} hint={`${stats.tenants_active ?? 0} active`} />
          <DenseStat label="People" value={stats.members ?? 0} hint={`${stats.admins ?? 0} admins`} />
          <DenseStat
            label="Without an admin"
            value={stats.tenants_without_admin ?? 0}
            hint={stats.tenants_without_admin ? "cannot appoint one themselves" : "all covered"}
            tone={(stats.tenants_without_admin ?? 0) > 0 ? "warn" : "good"}
          />
          <DenseStat label="Platform admins" value={stats.platform_admins ?? 0} hint="reach every business" />
        </StatStrip>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-faint">
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
        <div className={`${card} mb-3 p-3.5`}>
          <form
            action={(fd) =>
              start(async () => {
                const res = await createOrganisation(fd);
                if ("error" in res && res.error) return toast(res.error, "error");
                const r = res as { admin?: string | null; token?: string | null };
                setCreated({ name: String(fd.get("name")), admin: r.admin ?? null, token: r.token ?? null });
                toast(
                  r.admin === "invited" ? "Created. Send the administrator their link."
                  : r.admin === "appointed" ? "Created, and its administrator appointed."
                  : "Created. You hold it until you appoint somebody.",
                  "success",
                );
                setAdding(false);
                setName("");
                setSlug("");
                setPicked(products.map((p) => p.key));
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
            {/*
              Everything past the name is optional on purpose. A business
              created during a phone call must not be blocked on knowing its
              registered address, and a half-filled record beats a business
              that does not exist yet.
            */}
            <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
              <label className="block">
                <span className={label}>Website</span>
                <input name="website" placeholder="https://" className={field} />
              </label>
              <label className="block">
                <span className={label}>Contact email</span>
                <input name="contact_email" type="email" placeholder="hello@" className={field} />
              </label>
              <label className="block">
                <span className={label}>Phone</span>
                <input name="phone" className={field} />
              </label>
              <label className="block">
                <span className={label}>Industry</span>
                <input name="industry" placeholder="Events, Food, Software…" className={field} />
              </label>
              <label className="block">
                <span className={label}>City</span>
                <input name="city" className={field} />
              </label>
              <label className="block">
                <span className={label}>Country</span>
                <input name="country" className={field} />
              </label>
              <label className="block">
                <span className={label}>Employees</span>
                <input name="employee_count" type="number" min={0} placeholder="headcount" className={field} />
              </label>
              <label className="block">
                <span className={label}>Business started</span>
                <input name="started_on" type="date" className={field} />
              </label>
              <label className="block sm:col-span-1">
                <span className={label}>Address</span>
                <input name="address" className={field} />
              </label>
            </div>
            <label className="mt-2.5 block">
              <span className={label}>Notes</span>
              <input name="notes" placeholder="anything worth knowing about this business" className={field} />
            </label>

            {/*
              Which products this business needs.
              Every new business used to get all nine. The catalogue is what the
              platform sells, not what a business bought, and a nine-item
              sidebar for somebody who uses two is exactly the clutter the
              dense rebuild is against. The hidden field distinguishes "the
              form asked and you chose none" from "the form never asked".
            */}
            {products.length > 0 && (
              <div className="mt-3">
                <input type="hidden" name="products_asked" value="1" />
                <span className={label}>
                  Products ({picked.length === 0 ? "none" : `${picked.length} of ${products.length}`})
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {products.map((pr) => {
                    const on = picked.includes(pr.key);
                    return (
                      <label
                        key={pr.key}
                        className={`cursor-pointer rounded border px-2.5 py-1 text-[12px] font-medium transition-colors ${
                          on ? "border-brand bg-brand/10 text-brand-soft" : "border-line text-muted hover:border-brand/40"
                        }`}
                      >
                        <input
                          type="checkbox"
                          name="products"
                          value={pr.key}
                          checked={on}
                          onChange={() =>
                            setPicked((d) => (d.includes(pr.key) ? d.filter((x) => x !== pr.key) : [...d, pr.key]))
                          }
                          className="sr-only"
                        />
                        {pr.name}
                      </label>
                    );
                  })}
                </div>
                <div className="mt-1.5 flex gap-2 text-[11px] text-faint">
                  <button type="button" onClick={() => setPicked(products.map((x) => x.key))} className="hover:text-brand">
                    All
                  </button>
                  <button type="button" onClick={() => setPicked([])} className="hover:text-brand">
                    None
                  </button>
                  <span>· can be changed later from inside the business</span>
                </div>
              </div>
            )}

            {/*
              Who runs it. Without this the creator becomes the administrator,
              which is how the platform owner ended up administering
              Techxfluence -- a tenant like any other, which should have its
              own. Naming somebody here is what stops that.
            */}
            <label className="mt-3 block">
              <span className={label}>Administrator email</span>
              <input name="admin_email" type="email" placeholder="who will run this business" className={field} />
              <span className="mt-1 block text-[11px] text-faint">
                They are appointed if they already have an account, and invited if they do not — either
                way you get a link. Leave it blank and you hold the business until you appoint somebody.
              </span>
            </label>

            <p className="mt-3 rounded border border-line bg-surface-2/50 px-3 py-2 text-[11px] text-muted">
              It starts empty — no people, no events, no money — and sees nothing belonging to any
              other business. Only the name is required; everything else can be filled in later from
              this page.
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

      {created && (
        <div className="mb-3 rounded border border-emerald-200 bg-emerald-50 px-3.5 py-3">
          <p className="text-[12px] font-semibold text-emerald-900">{created.name} created.</p>
          {created.admin === "invited" && created.token ? (
            <>
              <p className="mt-1 text-[12px] text-emerald-900">
                Its administrator has no account yet, so they have been invited. Send them this link —
                nothing was emailed from here.
              </p>
              <p className="mt-1.5 break-all rounded border border-emerald-200 bg-white px-2 py-1 font-mono text-[11px] text-fg">
                {typeof window === "undefined" ? `/invite/${created.token}` : `${window.location.origin}/invite/${created.token}`}
              </p>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(`${window.location.origin}/invite/${created.token}`);
                  toast("Link copied", "success");
                }}
                className="mt-1.5 rounded-full border border-emerald-300 px-2.5 py-0.5 text-[11px] font-medium text-emerald-800"
              >
                Copy link
              </button>
            </>
          ) : created.admin === "appointed" ? (
            <p className="mt-1 text-[12px] text-emerald-900">Its administrator has been appointed.</p>
          ) : (
            <p className="mt-1 text-[12px] text-emerald-900">
              Nobody was named, so you hold it. Expand it below and appoint or invite its administrator.
            </p>
          )}
          <button type="button" onClick={() => setCreated(null)} className="mt-1.5 block text-[11px] text-emerald-800 hover:underline">
            Dismiss
          </button>
        </div>
      )}

      <div className="space-y-2">
        {orgs.map((o) => {
          const admins = adminsFor(o.id);
          const expanded = openOrg === o.id;
          return (
            <div key={o.id} className={card}>
              <div className="flex flex-wrap items-start justify-between gap-3 px-3.5 py-2.5">
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
                    <h3 className="flex flex-wrap items-center gap-2 font-display text-[13px] font-semibold text-fg">
                      {o.name}
                      {o.is_default && (
                        <span className="rounded bg-surface-2 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-faint">
                          Main
                        </span>
                      )}
                      {/*
                        Only a status worth acting on gets a pill. Showing
                        ACTIVE on every row broke this page own rule -- colour
                        means "attend to this", so a badge on the normal case
                        is colour spent saying nothing, and it drowns the
                        suspended row that actually needs the eye.
                      */}
                      {o.status !== "active" && (
                        <span className={`rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${STATUS_PILL[o.status] ?? ""}`}>
                          {o.status}
                        </span>
                      )}
                      {consoleMigrated && admins.length === 0 && (
                        <span className="rounded bg-amber-50 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                          No admin
                        </span>
                      )}
                    </h3>
                  )}
                  <p className="mt-1 text-xs text-faint">
                    <code className="font-mono text-[11px]">{o.slug}</code>
                    {" · "}{o.member_count} {o.member_count === 1 ? "person" : "people"}
                    {" · "}{o.product_count} products
                    {" · since "}{shortDate(o.created_at)}
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
  /** The address that turned out to have no account, so the offer can name it. */
  const [noAccount, setNoAccount] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  return (
    <div className="border-t border-line bg-surface-2/40 px-3.5 py-3">
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
                      {a.email} · since {shortDate(a.joined_at)}
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

          {/*
            Appoint, and fall back to invite.
            Appointing needs an existing account; setting a business up for a
            client is precisely when the administrator has none. The old error
            told you to "invite them from inside the business", which a
            platform owner cannot do — bos_invite_to_tenant invites into the
            REQUEST tenant, and this is a business you have no reason to be
            standing in. So the refusal becomes an offer.
          */}
          <form
            action={(fd) =>
              start(async () => {
                const res = await assignTenantAdmin(fd);
                if ("error" in res && res.error) {
                  if (res.error.includes("No account with the address")) {
                    setNoAccount(email.trim());
                    return;
                  }
                  return toast(res.error, "error");
                }
                toast(`Appointed to ${org.name}`, "success");
                setNoAccount(null);
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
          {noAccount && (
            <div className="mt-2.5 rounded border border-amber-200 bg-amber-50 px-3 py-2.5">
              <p className="text-[12px] text-amber-900">
                <strong className="font-semibold">{noAccount}</strong> has no account yet, so there is
                nobody to appoint. Invite them instead — they will get a link that creates their
                account and puts them straight into {org.name}.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    start(async () => {
                      const fd = new FormData();
                      fd.set("tenantId", org.id);
                      fd.set("email", noAccount);
                      fd.set("role", role);
                      const res = await inviteToTenantById(fd);
                      if ("error" in res && res.error) return toast(res.error, "error");
                      const link = `${window.location.origin}/invite/${(res as { token: string }).token}`;
                      await navigator.clipboard?.writeText(link).catch(() => {});
                      setInviteLink(link);
                      setNoAccount(null);
                      setEmail("");
                      toast("Invitation created and the link copied", "success");
                    })
                  }
                  className="rounded-full bg-brand px-3 py-1 text-[12px] font-semibold text-white disabled:opacity-50"
                >
                  Invite {noAccount} as {role === "admin" ? "admin" : role.replace(/_/g, " ")}
                </button>
                <button type="button" onClick={() => setNoAccount(null)} className="text-[11px] text-amber-800 hover:underline">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {inviteLink && (
            <div className="mt-2.5 rounded border border-line bg-surface-2/60 px-3 py-2.5">
              <p className="text-[11px] font-medium text-fg">Send them this link</p>
              <p className="mt-1 break-all font-mono text-[11px] text-muted">{inviteLink}</p>
              <p className="mt-1 text-[11px] text-faint">
                Copied to your clipboard. It lasts fourteen days, and it is for that address only —
                forwarding it does not hand over the seat. Nothing was emailed from here.
              </p>
            </div>
          )}

          <p className="mt-2 text-[11px] text-faint">
            Appointing adds somebody who already has an account. Inviting works for anybody. Both
            are written to {org.name} audit log.
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
        <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-faint">
          Platform administrators ({admins.length})
        </h2>
        <button type="button" onClick={() => setOpen((o) => !o)}
          className="rounded-full border border-line px-3 py-1 text-xs font-medium text-muted hover:border-brand hover:text-brand">
          {open ? "Cancel" : "+ Appoint"}
        </button>
      </div>

      {open && (
        <div className={`${card} mb-2 p-3.5`}>
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
                  <span className={`rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${
                    a.role === "super_admin" ? "bg-brand/10 text-brand-soft" : "bg-surface-2 text-faint"}`}>
                    {a.role === "super_admin" ? "Super admin" : "Support"}
                  </span>
                  {a.is_expired && (
                    <span className="rounded bg-amber-50 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                      Expired
                    </span>
                  )}
                  {a.user_id === me && (
                    <span className="rounded bg-surface-2 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-faint">
                      You
                    </span>
                  )}
                </p>
                <p className="mt-0.5 truncate text-xs text-faint">
                  {a.email}
                  {a.granted_by_email && ` · appointed by ${a.granted_by_email}`}
                  {a.expires_at
                    ? ` · ${a.is_expired ? "ended" : "ends"} ${shortDate(a.expires_at)}`
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
