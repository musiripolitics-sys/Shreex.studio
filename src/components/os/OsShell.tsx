"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/Icon";
import { OS_SECTIONS } from "@/lib/os-modules";

/**
 * The Business OS shell.
 *
 * It used to render inside AppShell, so every page carried two navigations at
 * once — the app sidebar, then a wall of ~30 pills in ten rows underneath it.
 * That's why nothing was findable. This is a single, persistent left sidebar
 * with the groups laid out vertically, which is the shape that actually scales
 * to this many destinations.
 */
export function OsShell({
  email,
  children,
}: {
  email: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) =>
    href === "/admin/os"
      ? pathname === "/admin/os"
      : pathname === href || pathname.startsWith(href + "/");

  const current =
    OS_SECTIONS.flatMap((s) => s.items).find((i) => isActive(i.href))?.label ??
    "Business OS";

  const sidebar = (
    <nav className="flex h-full flex-col gap-5 overflow-y-auto p-4">
      {OS_SECTIONS.map((section) => (
        <div key={section.label}>
          <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
            {section.label}
          </p>
          <div className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors ${
                    active
                      ? "bg-brand/10 font-semibold text-brand-soft"
                      : "text-muted hover:bg-surface-2 hover:text-fg"
                  }`}
                >
                  <Icon
                    name={item.icon}
                    className={`h-4 w-4 shrink-0 ${active ? "text-brand" : "text-faint"}`}
                    strokeWidth={1.8}
                  />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-ink">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 border-r border-line bg-surface lg:block">
        <div className="flex h-14 items-center gap-2 border-b border-line px-4">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand text-xs font-bold text-white">
            OS
          </span>
          <span className="font-display text-sm font-bold text-fg">Business OS</span>
        </div>
        <div className="h-[calc(100vh-3.5rem)]">{sidebar}</div>
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default bg-black/50"
          />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-line bg-surface">
            <div className="flex h-14 items-center justify-between border-b border-line px-4">
              <span className="font-display text-sm font-bold text-fg">Business OS</span>
              <button onClick={() => setOpen(false)} className="text-sm text-faint">
                Close
              </button>
            </div>
            <div className="h-[calc(100vh-3.5rem)]">{sidebar}</div>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={() => setOpen(true)}
              aria-label="Open menu"
              className="rounded-lg border border-line p-1.5 text-muted lg:hidden"
            >
              <Icon name="settings" className="h-4 w-4" />
            </button>
            <span className="truncate font-display text-base font-bold text-fg">
              {current}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden text-xs text-faint sm:inline">{email}</span>
            <Link
              href="/admin"
              className="rounded-full border border-line px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-brand hover:text-brand"
            >
              Exit to admin
            </Link>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 md:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
