"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "@/components/Toast";
import { switchTenant } from "../actions";

/**
 * A top bar that says platform, not business.
 *
 * No notification bell, no approvals badge, no product nav. Those are all
 * about one business, and showing a platform operator one business unread
 * count while they look at three organisations is what made the old page feel
 * wrong. The only business-shaped control here is the one that takes you INTO
 * a business, which is the point at which the OS chrome becomes correct.
 */
export function PlatformTopBar({
  email,
  tenants,
}: {
  email: string;
  tenants: { id: string; slug: string; name: string; role: string; is_active: boolean }[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-fg/95 text-white backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/15 text-[11px] font-bold">
            P
          </span>
          <span className="truncate font-display text-base font-bold">Platform</span>
          <span className="hidden truncate rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] sm:inline">
            Super admin
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden max-w-[14rem] truncate text-xs text-white/70 md:inline">{email}</span>

          <div className="relative">
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              disabled={pending}
              aria-haspopup="menu"
              aria-expanded={open}
              className="flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-sm font-medium hover:bg-white/25 disabled:opacity-50"
            >
              Enter a business
              <svg viewBox="0 0 24 24" aria-hidden className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {open && (
              <>
                <button aria-label="Close" onClick={() => setOpen(false)} className="fixed inset-0 z-40 cursor-default" />
                <div role="menu" className="absolute right-0 z-50 mt-1 w-64 overflow-hidden rounded-xl border border-line bg-surface text-fg shadow-lg">
                  <p className="border-b border-line px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
                    Entering is logged in that business
                  </p>
                  {tenants.length === 0 ? (
                    <p className="px-3 py-3 text-xs text-muted">No active businesses yet.</p>
                  ) : (
                    tenants.map((t) => (
                      <button
                        key={t.id}
                        role="menuitem"
                        disabled={pending}
                        onClick={() =>
                          start(async () => {
                            const res = await switchTenant(t.id);
                            if (res && "error" in res && res.error) return toast(res.error, "error");
                            setOpen(false);
                            window.location.href = "/shreex/dashboard";
                          })
                        }
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-fg hover:bg-surface-2 disabled:opacity-50"
                      >
                        <span className="min-w-0">
                          <span className="block truncate">{t.name}</span>
                          <span className="block truncate font-mono text-[11px] text-faint">{t.slug}</span>
                        </span>
                        <span className="shrink-0 text-[11px] text-faint">open →</span>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>

          <Link
            href="/"
            className="rounded-lg px-2.5 py-1.5 text-xs text-white/70 hover:bg-white/10 hover:text-white"
          >
            Site
          </Link>
        </div>
      </div>
    </header>
  );
}
