"use client";

import { createContext, useContext, useMemo, useState, useTransition } from "react";
import { toast } from "@/components/Toast";
import { Card, EmptyState } from "@/components/os/ui";
import {
  createEmployee, offboardEmployee, setModuleAccess, setProductEnabled,
  setTenantProduct, setMemberRole, removeMember, inviteToTenant, revokeInvitation,
} from "../../actions";

export type PersonRow = {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  joined: string;
  title: string | null;
  department: string | null;
  sections: string[];
  /**
   * Whether they are an active member of the business being looked at. Since
   * 0047 a person can be in the directory of one business and not another, and
   * the membership controls have to be absent rather than broken for somebody
   * this business cannot act on.
   */
  inThisBusiness?: boolean;
};

export type ProductRow = {
  key: string;
  name: string;
  description: string | null;
  is_enabled: boolean;
};

/** The catalogue as one business sees it, from bos_tenant_products(). */
export type TenantProductRow = {
  key: string;
  name: string;
  description: string | null;
  sort_order: number;
  catalogue_enabled: boolean;
  tenant_enabled: boolean;
  /** False means this business has made no choice and is following the catalogue. */
  has_row: boolean;
};

export type InvitationRow = {
  id: string;
  email: string;
  role: string;
  sections: string[];
  token: string;
  created_at: string;
  expires_at: string;
};

/**
 * The product catalogue, read from public.products by the page above.
 *
 * It used to be a constant here — the fourth copy of the same nine keys,
 * after os-access.ts, the OS actions and a CHECK constraint in migration
 * 0016. Stage 1 of the Shreex product model plan left one copy, in the database.
 *
 * Passed by context rather than threaded as a prop, because three separate
 * components in this file need it and none of them needs anything else.
 */
const ProductsCtx = createContext<ProductRow[]>([]);
/** Only the products that are switched on. Granting a disabled one is pointless. */
const useGrantable = () => useContext(ProductsCtx).filter((p) => p.is_enabled);

/**
 * The team, and what each of them can open.
 *
 * Staff only. Members belong to the public site and were never useful here.
 * Employees are onboarded from this page rather than signing up and being
 * promoted, so the OS owns its own roster.
 *
 * Access is granted by ticking sections, which is the same vocabulary the
 * sidebar uses — so what an admin ticks here is literally what the employee
 * will see. Admins are listed but not editable: they always have everything,
 * and letting one be edited invites locking the last admin out.
 */
export function AccessClient({
  people,
  products,
  migrated,
  productsMigrated,
  tenantProducts,
  tenantProductsMigrated,
  invitations,
  invitationsMigrated,
  platformOwner,
  businessName,
}: {
  people: PersonRow[];
  products: ProductRow[];
  migrated: boolean;
  productsMigrated: boolean;
  tenantProducts: TenantProductRow[];
  tenantProductsMigrated: boolean;
  invitations: InvitationRow[];
  invitationsMigrated: boolean;
  platformOwner: boolean;
  businessName: string;
}) {
  const [saving, start] = useTransition();
  const grantable = products.filter((p) => p.is_enabled);
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return people;
    return people.filter(
      (p) =>
        (p.name ?? "").toLowerCase().includes(t) ||
        (p.email ?? "").toLowerCase().includes(t) ||
        (p.title ?? "").toLowerCase().includes(t),
    );
  }, [people, q]);

  const employees = filtered.filter((p) => p.role === "employee");
  const admins = filtered.filter((p) => p.role === "admin");

  const run = (fn: () => Promise<{ error?: string } | { success: boolean }>, ok: string) =>
    start(async () => {
      const res = await fn();
      if (res && "error" in res && res.error) toast(res.error, "error");
      else toast(ok, "success");
    });

  const openEditor = (p: PersonRow) => {
    setOpenId(p.id);
    setDraft(p.sections);
  };

  const editorProps = (p: PersonRow) => ({
    person: p,
    editing: openId === p.id,
    draft,
    saving,
    onEdit: () => openEditor(p),
    onCancel: () => setOpenId(null),
    onToggle: (sec: string) =>
      setDraft((d) => (d.includes(sec) ? d.filter((x) => x !== sec) : [...d, sec])),
    onSelectAll: () => setDraft(grantable.map((pr) => pr.key)),
    onClear: () => setDraft([]),
    onSave: () => {
      run(() => setModuleAccess(p.id, draft), "Access updated");
      setOpenId(null);
    },
    onOffboard: () => run(() => offboardEmployee(p.id), "Employee offboarded"),
    onRole: (role: string) => run(() => setMemberRole(p.id, role), "Role updated"),
    onRemove: () => run(() => removeMember(p.id), "Removed from this business"),
    inThisBusiness: p.inThisBusiness !== false,
  });

  return (
    <ProductsCtx.Provider value={products}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-bold tracking-tight text-fg">Team &amp; Access</h1>
        <div className="flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, email or role…"
            className="w-56 rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm text-fg outline-none focus:border-brand"
          />
          <button
            onClick={() => setAdding((a) => !a)}
            className="rounded-full bg-brand px-4 py-1.5 text-sm font-medium text-white"
          >
            {adding ? "Cancel" : "+ Add employee"}
          </button>
        </div>
      </div>
      <p className="mb-5 max-w-2xl text-sm text-muted">
        The people who work here, and which sections of the Shreex each of
        them can open. Ticking a section is exactly what they will see in their
        sidebar. Community members are not listed — they belong to the public
        site, not to the OS.
      </p>

      {!migrated && (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run migration <span className="font-mono">0016_employee_access.sql</span> in Supabase to
          start assigning access. Until then nobody but an admin can open the OS.
        </div>
      )}

      {adding && (
        <AddEmployee
          saving={saving}
          onDone={() => setAdding(false)}
          onSubmit={(payload, done) =>
            start(async () => {
              const res = await createEmployee(payload);
              if ("error" in res && res.error) {
                toast(res.error, "error");
                return;
              }
              toast(
                "promoted" in res && res.promoted
                  ? "That account already existed and is now an employee"
                  : "Employee onboarded",
                "success",
              );
              done();
            })
          }
        />
      )}

      <Section title={`Employees (${employees.length})`}>
        {employees.length === 0 ? (
          <EmptyState
            title="No employees yet"
            hint="Add one above. They get an account, a role and their sections in one step."
          />
        ) : (
          <div className="divide-y divide-line">
            {employees.map((p) => (
              <PersonLine key={p.id} {...editorProps(p)} />
            ))}
          </div>
        )}
      </Section>

      <Section title={`Admins (${admins.length})`}>
        <div className="divide-y divide-line">
          {admins.map((p) => (
            <PersonLine key={p.id} {...editorProps(p)} />
          ))}
        </div>
      </Section>

      <Invitations
        invitations={invitations}
        migrated={invitationsMigrated}
        businessName={businessName}
        grantable={grantable}
        saving={saving}
        onInvite={(payload, done) =>
          start(async () => {
            const res = await inviteToTenant(payload);
            if ("error" in res && res.error) return toast(res.error, "error");
            toast("Invitation created. Copy the link and send it.", "success");
            done();
          })
        }
        onRevoke={(id) => run(() => revokeInvitation(id), "Invitation withdrawn")}
      />

      <TenantProducts
        rows={tenantProducts}
        migrated={tenantProductsMigrated}
        businessName={businessName}
        counts={people.reduce<Record<string, number>>((a, p) => {
          for (const k of p.sections) a[k] = (a[k] ?? 0) + 1;
          return a;
        }, {})}
        saving={saving}
        onToggle={(key, enabled) =>
          run(
            () => setTenantProduct(key, enabled),
            enabled ? `Turned on for ${businessName}` : `Turned off for ${businessName}`,
          )
        }
      />

      {/* The platform catalogue. Since 0051 only a platform owner may write
          it, because products has no tenant_id and one business switching a
          product off used to switch it off for every business. */}
      {platformOwner && (
        <Products
          products={products}
          migrated={productsMigrated}
          counts={people.reduce<Record<string, number>>((a, p) => {
            for (const k of p.sections) a[k] = (a[k] ?? 0) + 1;
            return a;
          }, {})}
          saving={saving}
          onToggle={(key, enabled) =>
            run(() => setProductEnabled(key, enabled), enabled ? "Product enabled" : "Product disabled")
          }
        />
      )}
    </ProductsCtx.Provider>
  );
}

/**
 * The product catalogue, and the switch for each one.
 *
 * It lives on this page rather than behind a section guard on purpose: off
 * means off for everyone, admins included, so a toggle reachable only through
 * a guarded page could be used to lock the last admin out of un-toggling it.
 * This page is guarded by isAdmin directly.
 *
 * Disabling leaves grants alone, so re-enabling restores exactly who had it.
 * The count beside each product is how many employees hold it, which is the
 * number that tells you whether switching it off will be noticed.
 */
function Products({
  products,
  migrated,
  counts,
  saving,
  onToggle,
}: {
  products: ProductRow[];
  migrated: boolean;
  counts: Record<string, number>;
  saving: boolean;
  onToggle: (key: string, enabled: boolean) => void;
}) {
  return (
    <div className="mb-6">
      <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
        Products ({products.filter((p) => p.is_enabled).length} of {products.length} on)
      </h2>

      {!migrated ? (
        <Card>
          <p className="text-sm text-muted">
            Run migration <span className="font-mono">0033_products.sql</span> in Supabase to
            manage the product catalogue. Until then the nine built-in products are all on and
            cannot be renamed or switched off.
          </p>
        </Card>
      ) : (
        <Card className="p-0">
          <div className="divide-y divide-line">
            {products.map((pr) => {
              const held = counts[pr.key] ?? 0;
              return (
                <div key={pr.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium text-fg">
                      {pr.name}
                      <span className="font-mono text-[11px] font-normal text-faint">{pr.key}</span>
                      {!pr.is_enabled && (
                        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
                          Off
                        </span>
                      )}
                    </p>
                    {pr.description && (
                      <p className="mt-0.5 truncate text-xs text-muted">{pr.description}</p>
                    )}
                  </div>

                  <span className="shrink-0 text-xs text-faint">
                    {held === 0
                      ? "admins only"
                      : `${held} employee${held === 1 ? "" : "s"}`}
                  </span>

                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => onToggle(pr.key, !pr.is_enabled)}
                    aria-pressed={pr.is_enabled}
                    className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                      pr.is_enabled
                        ? "border-line text-muted hover:border-red-300 hover:text-red-600"
                        : "border-brand/40 bg-brand/10 text-brand-soft hover:bg-brand/20"
                    }`}
                  >
                    {pr.is_enabled ? "Turn off" : "Turn on"}
                  </button>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <p className="mt-2 max-w-2xl text-xs text-muted">
        Turning a product off hides it from every sidebar and refuses its pages
        to everyone, admins included. Grants are kept, so turning it back on
        restores exactly who had it.
      </p>
    </div>
  );
}

/** Onboarding form: account, role, profile and sections in one submit. */
function AddEmployee({
  saving,
  onDone,
  onSubmit,
}: {
  saving: boolean;
  onDone: () => void;
  onSubmit: (payload: Record<string, unknown>, done: () => void) => void;
}) {
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    password: "",
    title: "",
    department: "",
    start_date: "",
  });
  const [sections, setSections] = useState<string[]>([]);
  const grantable = useGrantable();
  const field =
    "w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-fg outline-none focus:border-brand";

  return (
    <Card className="mb-6">
      <h2 className="mb-3 font-display text-sm font-semibold text-fg">Add an employee</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {([
          ["full_name", "Full name", "text"],
          ["email", "Work email", "email"],
          ["password", "Initial password", "text"],
          ["title", "Job title", "text"],
          ["department", "Department", "text"],
          ["start_date", "Start date", "date"],
        ] as const).map(([key, label, type]) => (
          <label key={key} className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
              {label}
            </span>
            <input
              type={type}
              value={form[key]}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              className={field}
            />
          </label>
        ))}
      </div>

      <p className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
        Sections they can open
      </p>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5">
        {grantable.map(({ key: k, name: label }) => {
          const on = sections.includes(k);
          return (
            <button
              key={k}
              onClick={() => setSections((s) => (on ? s.filter((x) => x !== k) : [...s, k]))}
              className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                on
                  ? "border-brand/40 bg-brand/10 font-medium text-brand-soft"
                  : "border-line text-muted hover:border-brand/30"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          disabled={saving || !form.full_name.trim() || !form.email.trim() || form.password.length < 6}
          onClick={() =>
            onSubmit({ ...form, sections }, () => {
              setForm({ full_name: "", email: "", password: "", title: "", department: "", start_date: "" });
              setSections([]);
              onDone();
            })
          }
          className="rounded-full bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? "Creating…" : "Create employee"}
        </button>
        <span className="text-[11px] text-faint">
          Creates the account and grants the ticked sections. They set their own
          password using &ldquo;Forgot password&rdquo; on the sign-in page.
        </span>
      </div>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">{title}</h2>
      <Card className="p-0">{children}</Card>
    </div>
  );
}

function PersonLine({
  person: p,
  editing,
  draft,
  saving,
  onEdit,
  onCancel,
  onToggle,
  onSelectAll,
  onClear,
  onSave,
  onOffboard,
  onRole,
  onRemove,
  inThisBusiness = true,
}: {
  person: PersonRow;
  editing: boolean;
  draft: string[];
  saving: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onToggle: (s: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
  onSave: () => void;
  onOffboard: () => void;
  onRole?: (role: string) => void;
  onRemove?: () => void;
  inThisBusiness?: boolean;
}) {
  const isAdminRow = p.role === "admin";
  const grantable = useGrantable();

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand/10 text-[11px] font-semibold text-brand-soft">
          {(p.name || p.email || "?").slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-fg">{p.name || "No name"}</p>
          <p className="truncate text-xs text-faint">
            {p.email}
            {p.title ? ` · ${p.title}` : ""}
            {p.department ? ` · ${p.department}` : ""}
          </p>
        </div>

        {/* Role IN THIS BUSINESS. Since 0047 that is the only authority, and
            users.primary_role is a mirror of the default business that is
            simply wrong for anybody else. The database refuses to demote the
            last admin, so this control cannot strand a business. */}
        {onRole && inThisBusiness && (
          <select
            value={p.role}
            disabled={saving}
            onChange={(e) => onRole(e.target.value)}
            aria-label={`Role of ${p.name || p.email || "this person"} in this business`}
            className="shrink-0 rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] font-medium text-muted outline-none focus:border-brand disabled:opacity-50"
          >
            <option value="admin">Admin</option>
            <option value="employee">Employee</option>
            <option value="event_host">Event host</option>
            <option value="community_member">Community member</option>
          </select>
        )}

        {isAdminRow ? (
          <span className="rounded-full bg-brand/10 px-2.5 py-1 text-[11px] font-medium text-brand-soft">
            All sections
          </span>
        ) : (
          <>
            <button
              onClick={editing ? onCancel : onEdit}
              className="rounded-full border border-line px-3 py-1 text-xs font-medium text-muted hover:border-brand hover:text-brand"
            >
              {editing ? "Cancel" : p.sections.length === 0 ? "No access" : `${p.sections.length} sections`}
            </button>
            <button
              onClick={onOffboard}
              disabled={saving}
              title="Revoke every section and end their employment"
              className="text-xs font-medium text-faint hover:text-red-600 disabled:opacity-50"
            >
              Offboard
            </button>
          </>
        )}

        {/* Removing somebody from a business is not the same as offboarding an
            employee: it ends one membership and leaves the account, and any
            other business they are in, alone. */}
        {onRemove && inThisBusiness && (
          <button
            onClick={onRemove}
            disabled={saving}
            title="End their membership of this business. Their account and any other business they belong to are untouched."
            className="shrink-0 text-xs font-medium text-faint hover:text-red-600 disabled:opacity-50"
          >
            Remove
          </button>
        )}
      </div>

      {!editing && !isAdminRow && p.sections.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5 pl-11">
          {grantable
            .filter((pr) => p.sections.includes(pr.key))
            .map((pr) => (
              <span key={pr.key} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">
                {pr.name}
              </span>
            ))}
        </div>
      )}

      {editing && !isAdminRow && (
        <div className="mt-3 rounded-xl border border-line bg-surface-2/50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
              Sections this person can open
            </p>
            <div className="flex gap-2 text-[11px]">
              <button onClick={onSelectAll} className="text-brand-soft hover:underline">
                All
              </button>
              <button onClick={onClear} className="text-muted hover:underline">
                None
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {grantable.map(({ key: k, name: label }) => {
              const on = draft.includes(k);
              return (
                <button
                  key={k}
                  onClick={() => onToggle(k)}
                  className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors ${
                    on
                      ? "border-brand/40 bg-brand/10 font-medium text-brand-soft"
                      : "border-line text-muted hover:border-brand/30"
                  }`}
                >
                  <span
                    className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded border ${
                      on ? "border-brand bg-brand text-white" : "border-line"
                    }`}
                  >
                    {on && (
                      <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M2 6.5L4.5 9 10 3.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  {label}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              disabled={saving}
              onClick={onSave}
              className="rounded-full bg-brand px-4 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save access"}
            </button>
            <span className="text-[11px] text-faint">
              {draft.length === 0
                ? "They will not be able to open the Shreex."
                : `${draft.length} of 9 sections`}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Invitations to this business.
 *
 * bos_invite_to_tenant has existed since 0047 with nothing calling it, so a
 * person who already had an account — a member who signed up on the public
 * site, or somebody working at another business on the platform — could not be
 * added at all. "Add employee" creates an account and fails for an address
 * that has one.
 *
 * The token is shown rather than emailed because sending it is a decision this
 * page should not make silently: an invitation is a seat in a business.
 * Re-inviting the same address replaces the invitation and issues a new token,
 * so a link that leaked is revoked by issuing another.
 */
function Invitations({
  invitations,
  migrated,
  businessName,
  grantable,
  saving,
  onInvite,
  onRevoke,
}: {
  invitations: InvitationRow[];
  migrated: boolean;
  businessName: string;
  grantable: ProductRow[];
  saving: boolean;
  onInvite: (
    payload: { email: string; role: string; sections: string[] },
    done: () => void,
  ) => void;
  onRevoke: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("employee");
  const [secs, setSecs] = useState<string[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const field =
    "w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-fg outline-none focus:border-brand";

  const link = (token: string) =>
    typeof window === "undefined" ? `/invite/${token}` : `${window.location.origin}/invite/${token}`;

  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
          Invitations ({invitations.length} pending)
        </h2>
        {migrated && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="rounded-full border border-line px-3 py-1 text-xs font-medium text-muted hover:border-brand hover:text-brand"
          >
            {open ? "Cancel" : "+ Invite someone"}
          </button>
        )}
      </div>

      {!migrated ? (
        <Card>
          <p className="text-sm text-muted">
            Run migration <span className="font-mono">0047_switching_and_invitations.sql</span> to
            invite somebody who already has an account.
          </p>
        </Card>
      ) : (
        <>
          {open && (
            <Card className="mb-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
                    Email
                  </span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="them@example.com"
                    autoFocus
                    className={field}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
                    Role in {businessName}
                  </span>
                  <select value={role} onChange={(e) => setRole(e.target.value)} className={field}>
                    <option value="employee">Employee</option>
                    <option value="admin">Admin</option>
                    <option value="event_host">Event host</option>
                    <option value="community_member">Community member</option>
                  </select>
                </label>
              </div>

              <p className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
                Sections they can open
              </p>
              <div className="flex flex-wrap gap-1.5">
                {grantable.map((pr) => (
                  <button
                    key={pr.key}
                    type="button"
                    onClick={() =>
                      setSecs((d) => (d.includes(pr.key) ? d.filter((x) => x !== pr.key) : [...d, pr.key]))
                    }
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      secs.includes(pr.key)
                        ? "border-brand bg-brand/10 text-brand-soft"
                        : "border-line text-muted hover:border-brand/30"
                    }`}
                  >
                    {pr.name}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-faint">
                An admin gets every section whether ticked or not. Nothing here affects any other
                business they belong to.
              </p>

              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  disabled={saving || !email.includes("@")}
                  onClick={() =>
                    onInvite({ email, role, sections: secs }, () => {
                      setEmail("");
                      setSecs([]);
                      setOpen(false);
                    })
                  }
                  className="rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? "Inviting…" : "Create invitation"}
                </button>
                <span className="text-[11px] text-faint">
                  You will get a link to send them. Nothing is emailed from here.
                </span>
              </div>
            </Card>
          )}

          {invitations.length === 0 ? (
            <Card>
              <p className="text-sm text-muted">
                Nobody is waiting on an invitation. Use this for a person who already has an
                account; &ldquo;Add employee&rdquo; is for somebody with none.
              </p>
            </Card>
          ) : (
            <Card className="p-0">
              <div className="divide-y divide-line">
                {invitations.map((inv) => {
                  const expired = new Date(inv.expires_at) < new Date();
                  return (
                    <div key={inv.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
                          {inv.email}
                          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
                            {inv.role.replace(/_/g, " ")}
                          </span>
                          {expired && (
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                              Expired
                            </span>
                          )}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-faint">
                          {inv.sections.length === 0
                            ? "no sections"
                            : `${inv.sections.length} section${inv.sections.length === 1 ? "" : "s"}`}
                          {" · expires "}
                          {new Date(inv.expires_at).toLocaleDateString()}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(link(inv.token));
                          setCopied(inv.id);
                          toast("Invitation link copied", "success");
                        }}
                        className="shrink-0 rounded-full border border-line px-3 py-1 text-xs font-medium text-muted hover:border-brand hover:text-brand"
                      >
                        {copied === inv.id ? "Copied" : "Copy link"}
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => onRevoke(inv.id)}
                        className="shrink-0 text-xs font-medium text-faint hover:text-red-600 disabled:opacity-50"
                      >
                        Withdraw
                      </button>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Which products this business has.
 *
 * Distinct from the catalogue below it, and the distinction is the point: the
 * catalogue is what the platform sells, this is what one business bought.
 * 0050 seeded tenant_products and nothing read it, so until 0051 every
 * business showed all nine products whatever its rows said.
 *
 * A product with no row is following the catalogue rather than switched on,
 * and the page says so — claiming a decision nobody made is how a per-business
 * list stops being trustworthy.
 */
function TenantProducts({
  rows,
  migrated,
  businessName,
  counts,
  saving,
  onToggle,
}: {
  rows: TenantProductRow[];
  migrated: boolean;
  businessName: string;
  counts: Record<string, number>;
  saving: boolean;
  onToggle: (key: string, enabled: boolean) => void;
}) {
  if (!migrated) {
    return (
      <div className="mb-6">
        <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
          Products in {businessName}
        </h2>
        <Card>
          <p className="text-sm text-muted">
            Run migration{" "}
            <span className="font-mono">0051_tenant_membership_and_products.sql</span> to give this
            business its own product list. Until then every business shows whatever the platform
            catalogue says.
          </p>
        </Card>
      </div>
    );
  }

  const on = rows.filter((r) => r.tenant_enabled).length;

  return (
    <div className="mb-6">
      <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
        Products in {businessName} ({on} of {rows.length} on)
      </h2>
      <Card className="p-0">
        <div className="divide-y divide-line">
          {rows.map((r) => {
            const held = counts[r.key] ?? 0;
            return (
              <div key={r.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
                    {r.name}
                    <span className="font-mono text-[11px] font-normal text-faint">{r.key}</span>
                    {!r.catalogue_enabled && (
                      <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
                        Off platform-wide
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-faint">
                    {r.has_row
                      ? r.tenant_enabled
                        ? "on for this business"
                        : "switched off for this business"
                      : "following the platform catalogue"}
                    {held > 0 && ` · ${held} employee${held === 1 ? "" : "s"} hold it`}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => onToggle(r.key, !r.tenant_enabled)}
                  aria-pressed={r.tenant_enabled}
                  className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                    r.tenant_enabled
                      ? "border-line text-muted hover:border-red-300 hover:text-red-600"
                      : "border-brand/40 bg-brand/10 text-brand-soft hover:bg-brand/20"
                  }`}
                >
                  {r.tenant_enabled ? "Turn off" : "Turn on"}
                </button>
              </div>
            );
          })}
        </div>
      </Card>
      <p className="mt-2 max-w-2xl text-xs text-muted">
        Switching a product off here hides it from every sidebar in {businessName} and refuses its
        pages to everyone here, admins included. It changes nothing in any other business. Grants
        are kept, so turning it back on restores exactly who had it.
      </p>
    </div>
  );
}
