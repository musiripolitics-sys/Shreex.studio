"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/Icon";
import { NotificationBell } from "@/components/NotificationBell";
import { GlobalSearch } from "./GlobalSearch";
import { switchTenant } from "@/app/admin/os/actions";
import { toast } from "@/components/Toast";
import { OS_SECTIONS, type NavSection } from "@/lib/os-modules";

/**
 * The Business OS shell.
 *
 * The sidebar used to list every one of ~35 destinations at once, which meant
 * scrolling to reach anything past Marketing. It now shows the Dashboard and
 * the nine sections by name — ten rows, which fit any screen without
 * scrolling — and each section reveals its own items on hover.
 *
 * Alerts, approvals, the signed-in account and the way out sit top right,
 * because they are about the session rather than about navigating the plan.
 */
export function OsShell({
  email,
  isAdmin = false,
  sections,
  productNames = {},
  tenants = [],
  alertCount = 0,
  approvalCount = 0,
  children,
}: {
  email: string;
  isAdmin?: boolean;
  /** Product keys this user may open. Admins receive every enabled one. */
  sections: string[];
  /**
   * key -> display name from the products catalogue. An admin who renames
   * Govern to Compliance renames it here too, which is why the nav reads a
   * name rather than hard-coding one.
   */
  productNames?: Record<string, string>;
  /**
   * The businesses this person belongs to. One or none renders nothing: a
   * switcher with a single option is a label pretending to be a control.
   */
  tenants?: { id: string; slug: string; name: string; role: string; is_active: boolean }[];
  alertCount?: number;
  approvalCount?: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  // The panel is positioned fixed rather than absolute. The sidebar scrolls,
  // and an absolutely positioned child of a scrolling box is clipped into it
  // — which is why hovering a section used to make the sidebar scroll
  // sideways instead of floating the list over the page.
  // Keyed by product key, not by label: labels are editable data now, and a
  // flyout that loses track of itself the moment somebody renames a section
  // is a bug waiting for the first rename.
  const [flyout, setFlyout] = useState<{ key: string; x: number; y: number } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);
  const openFlyout = useCallback((key: string, el: HTMLElement) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    const r = el.getBoundingClientRect();
    setFlyout({ key, x: r.right + 8, y: r.top });
  }, []);
  // A grace period, so crossing the gap to the panel does not close it.
  const scheduleClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setFlyout(null), 140);
  }, []);

  const isActive = (href: string) =>
    href === "/admin/os" ? pathname === "/admin/os" : pathname === href || pathname.startsWith(href + "/");

  // "Today" holds the dashboard plus the two things that moved to the top bar,
  // so the rail shows the nine planning sections and nothing else.
  // The nav shows only what the grant allows, so an employee never sees a
  // door they cannot open. "Today" is ungated.
  const allowed = new Set(sections);

  // The nav with catalogue names substituted in, so every child below renders
  // section.label and gets the live name without knowing the catalogue exists.
  const nav: NavSection[] = useMemo(
    () =>
      OS_SECTIONS.map((s) =>
        s.key && productNames[s.key] ? { ...s, label: productNames[s.key] } : s,
      ),
    [productNames],
  );
  // An admin has ~35 destinations, so their sections stay collapsed behind a
  // hover. An employee usually holds two or three, which fit expanded — and a
  // section header that only reacts to hover reads as broken when clicked.
  const expandAll = !isAdmin;

  // Matched on the product key. This used to lowercase the group label, which
  // meant a renamed group silently lost its grant and a two-word label could
  // never match one at all.
  const railSections = nav.filter((s) => s.key !== null && allowed.has(s.key));
  // Pages reached from the top bar are not in the nav, so they need naming
  // here or the title bar keeps saying "Dashboard".
  const OFF_NAV: Record<string, string> = { "/admin/os/team/access": "Team & Access" };
  const current =
    nav.flatMap((s) => s.items).find((i) => isActive(i.href))?.label ??
    Object.entries(OFF_NAV).find(([href]) => isActive(href))?.[1] ??
    "Dashboard";
  const activeSection = railSections.find((s) => s.items.some((i) => isActive(i.href)));
  const groupKey = (s: NavSection) => s.key ?? "today";

  return (
    <div className="flex min-h-screen bg-ink">
      {/* ── Rail ── */}
      {/* Sticky to the viewport: the sidebar is the fixed frame you navigate
          from, so it must not scroll away with the page under it. h-screen
          plus overflow-y-auto keeps it usable on a very short window too. */}
      <aside className="sticky top-0 z-40 hidden h-screen w-60 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface lg:flex">
        <Link href="/admin/os" className="flex h-14 items-center gap-2.5 border-b border-line px-4">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand text-[11px] font-bold text-white">
            OS
          </span>
          <span className="font-display text-sm font-bold text-fg">Business OS</span>
        </Link>

        <Link
          href="/admin/os"
          aria-current={pathname === "/admin/os" ? "page" : undefined}
          className={`mx-2 mt-3 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
            pathname === "/admin/os"
              ? "bg-brand/10 font-semibold text-brand-soft"
              : "text-muted hover:bg-surface-2 hover:text-fg"
          }`}
        >
          <Icon name="home" className="h-[17px] w-[17px] shrink-0" strokeWidth={1.8} />
          Dashboard
        </Link>

        <div className="mx-4 my-2.5 h-px bg-line" />

        <nav className="flex flex-col gap-0.5 overflow-y-auto px-2 pb-4">
          {railSections.map((section) => (
            expandAll ? (
              <ExpandedSection key={groupKey(section)} section={section} isActive={isActive} />
            ) : (
              <RailItem
                key={groupKey(section)}
                section={section}
                active={activeSection?.key === section.key}
                open={flyout?.key === section.key}
                onOpen={openFlyout}
                onLeave={scheduleClose}
                onDismiss={() => setFlyout(null)}
              />
            )
          ))}
        </nav>
      </aside>

      {/* ── Mobile drawer ── */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="Close menu"
            onClick={() => setDrawer(false)}
            className="absolute inset-0 cursor-default bg-black/50"
          />
          <aside className="absolute inset-y-0 left-0 w-72 overflow-y-auto border-r border-line bg-surface">
            <div className="flex h-14 items-center justify-between border-b border-line px-4">
              <span className="font-display text-sm font-bold text-fg">Business OS</span>
              <button onClick={() => setDrawer(false)} className="text-sm text-faint">
                Close
              </button>
            </div>
            <nav className="flex flex-col gap-5 p-4">
              {nav
                .filter((s) => s.key === null || allowed.has(s.key))
                .map((section) => (
                <div key={groupKey(section)}>
                  <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
                    {section.label}
                  </p>
                  <div className="flex flex-col gap-0.5">
                    {section.items.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setDrawer(false)}
                        className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm ${
                          isActive(item.href)
                            ? "bg-brand/10 font-semibold text-brand-soft"
                            : "text-muted hover:bg-surface-2 hover:text-fg"
                        }`}
                      >
                        <Icon name={item.icon} className="h-4 w-4 shrink-0 text-faint" strokeWidth={1.8} />
                        {item.label}
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </nav>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ── Top bar ── */}
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={() => setDrawer(true)}
              aria-label="Open menu"
              className="rounded-lg border border-line p-1.5 text-muted lg:hidden"
            >
              <Icon name="settings" className="h-4 w-4" />
            </button>
            <span className="truncate font-display text-base font-bold text-fg">{current}</span>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <TenantSwitcher tenants={tenants} />
            <GlobalSearch />
            {/* Approvals and reviews are decided by somebody else and land
                here; without this an employee had no way of hearing about it. */}
            <NotificationBell />
            <TopAction
              href="/admin/os/approvals"
              icon="check"
              label="Approvals"
              count={approvalCount}
              active={isActive("/admin/os/approvals")}
            />
            <TopAction
              href="/admin/os/alerts"
              icon="warning"
              label="Alerts"
              count={alertCount}
              tone="warn"
              active={isActive("/admin/os/alerts")}
            />
            {isAdmin && (
              <TopAction
                href="/admin/os/team/access"
                icon="users"
                label="People and access"
                count={0}
                active={isActive("/admin/os/team/access")}
              />
            )}
            <span className="mx-1 hidden h-5 w-px bg-line sm:block" />
            <span className="hidden max-w-[14rem] truncate text-xs text-faint sm:inline">{email}</span>
            <Link
              href="/admin"
              title="Exit to admin"
              className="rounded-full border border-line px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-brand hover:text-brand"
            >
              Exit
            </Link>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 md:px-6 lg:px-8">{children}</main>
      </div>

      {flyout && (
        <SectionFlyout
          section={nav.find((sec) => sec.key === flyout.key)!}
          x={flyout.x}
          y={flyout.y}
          isActive={isActive}
          onEnter={cancelClose}
          onLeave={scheduleClose}
        />
      )}
    </div>
  );
}

/**
 * Which business you are acting in, and a way to change it.
 *
 * Renders nothing at all when the person belongs to one business or none.
 * Techxfluence is one business today, so for everybody currently using this
 * the switcher is invisible — which is the right appearance for a control
 * with a single option.
 */
function TenantSwitcher({
  tenants,
}: {
  tenants: { id: string; slug: string; name: string; role: string; is_active: boolean }[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  if (tenants.length < 2) return null;

  const active = tenants.find((t) => t.is_active) ?? tenants[0];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex max-w-[11rem] items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-sm text-fg hover:bg-surface-2 disabled:opacity-50"
      >
        <Icon name="nodes" className="h-4 w-4 shrink-0 text-faint" strokeWidth={1.8} />
        <span className="truncate">{active?.name}</span>
        <svg viewBox="0 0 24 24" aria-hidden className="h-3 w-3 shrink-0 text-faint"
             fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <>
          <button
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            role="menu"
            className="absolute right-0 z-50 mt-1 w-60 overflow-hidden rounded-xl border border-line bg-surface shadow-lg"
          >
            <p className="border-b border-line px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
              Your businesses
            </p>
            {tenants.map((t) => (
              <button
                key={t.id}
                role="menuitem"
                disabled={pending || t.is_active}
                onClick={() =>
                  start(async () => {
                    const res = await switchTenant(t.id);
                    if (res && "error" in res && res.error) toast(res.error, "error");
                    else setOpen(false);
                  })
                }
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors ${
                  t.is_active
                    ? "bg-brand/10 font-medium text-brand-soft"
                    : "text-fg hover:bg-surface-2"
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate">{t.name}</span>
                  <span className="block truncate text-[11px] text-faint">{t.role}</span>
                </span>
                {t.is_active && (
                  <svg viewBox="0 0 12 12" aria-hidden className="h-3 w-3 shrink-0" fill="none"
                       stroke="currentColor" strokeWidth="2.5">
                    <path d="M2 6.5L4.5 9 10 3.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** A section with its destinations listed inline, for people who hold few. */
function ExpandedSection({
  section,
  isActive,
}: {
  section: NavSection;
  isActive: (href: string) => boolean;
}) {
  const hasActive = section.items.some((i) => isActive(i.href));
  // Null means "follow the route", so the section you are actually in is open
  // on arrival. Clicking the header takes that decision over until you click
  // it again.
  const [manual, setManual] = useState<boolean | null>(null);
  const open = manual ?? hasActive;

  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => setManual(!open)}
        aria-expanded={open}
        className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors hover:bg-surface-2 ${
          hasActive ? "text-brand-soft" : "text-faint hover:text-fg"
        }`}
      >
        <Icon name={section.icon} className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
        <span className="min-w-0 flex-1">{section.label}</span>
        <svg
          viewBox="0 0 24 24"
          aria-hidden
          className={`h-3 w-3 shrink-0 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="flex flex-col gap-0.5 pb-1">
          {section.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={`flex items-start gap-2.5 rounded-lg py-1.5 pl-7 pr-2.5 text-sm transition-colors ${
                isActive(item.href)
                  ? "bg-brand/10 font-semibold text-brand-soft"
                  : "text-muted hover:bg-surface-2 hover:text-fg"
              }`}
            >
              <Icon name={item.icon} className="mt-0.5 h-4 w-4 shrink-0 text-faint" strokeWidth={1.8} />
              {/* A name cut to "Competitor Tra…" is no use as a label; let it
                  take a second line instead. */}
              <span className="min-w-0 flex-1 leading-snug">{item.label}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** A section row. Hovering it asks the shell to float its list beside it. */
function RailItem({
  section,
  active,
  open,
  onOpen,
  onLeave,
  onDismiss,
}: {
  section: NavSection;
  active: boolean;
  open: boolean;
  /** Receives the product KEY, which is what the flyout is tracked by. */
  onOpen: (key: string, el: HTMLElement) => void;
  onLeave: () => void;
  onDismiss: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onMouseEnter={(e) => onOpen(section.key ?? "", e.currentTarget)}
      onFocus={(e) => onOpen(section.key ?? "", e.currentTarget)}
      onMouseLeave={onLeave}
      onKeyDown={(e) => e.key === "Escape" && onDismiss()}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
        active
          ? "bg-brand/10 font-semibold text-brand-soft"
          : open
            ? "bg-surface-2 text-fg"
            : "text-muted hover:bg-surface-2 hover:text-fg"
      }`}
    >
      <Icon name={section.icon} className="h-[17px] w-[17px] shrink-0" strokeWidth={1.8} />
      <span className="flex-1 text-left">{section.label}</span>
      <span className="text-[9px] text-faint">{section.items.length}</span>
    </button>
  );
}

/**
 * A section's destinations, floating above the page.
 *
 * Fixed, so no scrolling ancestor can clip it, and nudged up when it would
 * otherwise run off the bottom of the window.
 */
function SectionFlyout({
  section,
  x,
  y,
  isActive,
  onEnter,
  onLeave,
}: {
  section: NavSection;
  x: number;
  y: number;
  isActive: (href: string) => boolean;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const estimated = 44 + section.items.length * 34;
  const top =
    typeof window === "undefined"
      ? y
      : Math.max(8, Math.min(y, window.innerHeight - estimated - 8));

  return (
    <div
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{ position: "fixed", left: x, top }}
      className="z-[200] w-56 overflow-hidden rounded-xl border border-line bg-surface shadow-lg"
    >
      <p className="border-b border-line px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
        {section.label}
      </p>
      <div className="p-1">
        {section.items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
              isActive(item.href)
                ? "bg-brand/10 font-semibold text-brand-soft"
                : "text-muted hover:bg-surface-2 hover:text-fg"
            }`}
          >
            <Icon name={item.icon} className="h-4 w-4 shrink-0 text-faint" strokeWidth={1.8} />
            <span className="min-w-0 flex-1 leading-snug">{item.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/** Alerts and approvals: an icon, and a count only when there is something to see. */
function TopAction({
  href,
  icon,
  label,
  count,
  tone = "default",
  active,
}: {
  href: string;
  icon: string;
  label: string;
  count: number;
  tone?: "default" | "warn";
  active: boolean;
}) {
  return (
    <Link
      href={href}
      title={count > 0 ? `${label} — ${count} waiting` : label}
      aria-label={count > 0 ? `${label}, ${count} waiting` : label}
      className={`relative grid h-9 w-9 place-items-center rounded-lg transition-colors ${
        active ? "bg-brand/10 text-brand-soft" : "text-muted hover:bg-surface-2 hover:text-fg"
      }`}
    >
      <Icon name={icon} className="h-[18px] w-[18px]" strokeWidth={1.8} />
      {count > 0 && (
        <span
          className={`absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9px] font-bold text-white ${
            tone === "warn" ? "bg-red-500" : "bg-brand"
          }`}
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
