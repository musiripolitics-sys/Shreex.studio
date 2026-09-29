"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/Icon";
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
  alertCount = 0,
  approvalCount = 0,
  children,
}: {
  email: string;
  isAdmin?: boolean;
  /** Section keys this user may open. Admins receive all nine. */
  sections: string[];
  alertCount?: number;
  approvalCount?: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);

  const isActive = (href: string) =>
    href === "/admin/os" ? pathname === "/admin/os" : pathname === href || pathname.startsWith(href + "/");

  // "Today" holds the dashboard plus the two things that moved to the top bar,
  // so the rail shows the nine planning sections and nothing else.
  // The nav shows only what the grant allows, so an employee never sees a
  // door they cannot open. "Today" is ungated.
  const allowed = new Set(sections);
  const railSections = OS_SECTIONS.filter(
    (s) => s.label !== "Today" && allowed.has(s.label.toLowerCase()),
  );
  const current =
    OS_SECTIONS.flatMap((s) => s.items).find((i) => isActive(i.href))?.label ?? "Dashboard";
  const activeSection = railSections.find((s) => s.items.some((i) => isActive(i.href)));

  return (
    <div className="flex min-h-screen bg-ink">
      {/* ── Rail ── */}
      {/* Sticky to the viewport: the sidebar is the fixed frame you navigate
          from, so it must not scroll away with the page under it. h-screen
          plus overflow-y-auto keeps it usable on a very short window too. */}
      <aside className="sticky top-0 z-40 hidden h-screen w-52 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface lg:flex">
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

        <nav className="flex flex-col gap-0.5 px-2" onMouseLeave={() => setHovered(null)}>
          {railSections.map((section) => (
            <RailItem
              key={section.label}
              section={section}
              active={activeSection?.label === section.label}
              open={hovered === section.label}
              onHover={() => setHovered(section.label)}
              onDismiss={() => setHovered(null)}
              isActive={isActive}
            />
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
              {OS_SECTIONS.filter(
                (s) => s.label === "Today" || allowed.has(s.label.toLowerCase()),
              ).map((section) => (
                <div key={section.label}>
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
            <TopAction
              href="/admin/os/approvals"
              icon="check"
              label="Approvals"
              count={approvalCount}
              active={isActive("/admin/os/approvals")}
            />
            <TopAction
              href="/admin/os/alerts"
              icon="bell"
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
    </div>
  );
}

/** One rail icon, with its section list revealed on hover. */
function RailItem({
  section,
  active,
  open,
  onHover,
  onDismiss,
  isActive,
}: {
  section: NavSection;
  active: boolean;
  open: boolean;
  onHover: () => void;
  onDismiss: () => void;
  isActive: (href: string) => boolean;
}) {
  return (
    // Hover is the fast path, but focus opens it too so the rail is reachable
    // by keyboard, and Escape closes it without needing the mouse.
    <div
      className="relative"
      onMouseEnter={onHover}
      onFocus={onHover}
      onKeyDown={(e) => e.key === "Escape" && onDismiss()}
    >
      <button
        type="button"
        aria-expanded={open}
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

      {/* A transparent bridge so the pointer can cross the gap without the
          flyout closing underneath it. */}
      {open && (
        <>
          <span className="absolute left-full top-0 h-full w-2" />
          <div className="absolute left-full top-0 z-50 ml-2 w-56 overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
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
                  <span className="truncate">{item.label}</span>
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
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
