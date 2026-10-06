"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/Icon";
import { useDialogChrome } from "./useDialogChrome";

type Hit = {
  kind: string; id: string; title: string;
  subtitle: string | null; href: string; rank: number;
};

const KIND_TONE: Record<string, string> = {
  Task: "bg-blue-100 text-blue-700",
  Goal: "bg-brand/10 text-brand-soft",
  Event: "bg-amber-100 text-amber-700",
  Complaint: "bg-red-100 text-red-700",
  Risk: "bg-red-100 text-red-700",
  Person: "bg-green-100 text-green-700",
};

/**
 * One box for the whole OS.
 *
 * The query is a single function in the database rather than a request per
 * table, and it is not security definer — so what comes back is already
 * filtered by every policy that applies to whoever is typing. There is no
 * permission logic here, which is the point: there is nowhere for it to drift
 * out of step with the rest.
 */
export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [cursor, setCursor] = useState(0);
  const [searching, start] = useTransition();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const latest = useRef(0);

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setHits([]);
    setCursor(0);
  }, []);

  useDialogChrome(open, close);

  // ⌘K anywhere, which is what everybody's fingers already expect.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Debounced, and stamped — a slow early response must not overwrite a
  // faster later one and show results for a query nobody is looking at.
  useEffect(() => {
    const term = q.trim();
    // Below two characters nothing is searched and nothing is shown — the
    // render guards on the same length, so stale hits can never appear and
    // clearing them here would only be a setState during render.
    if (term.length < 2) return;
    const stamp = ++latest.current;
    const timer = setTimeout(() => {
      start(async () => {
        const supabase = createClient();
        const { data } = await supabase.rpc("bos_search", { p_q: term, p_limit: 30 });
        if (stamp === latest.current) {
          setHits((data as Hit[]) ?? []);
          setCursor(0);
        }
      });
    }, 180);
    return () => clearTimeout(timer);
  }, [q]);

  const go = useCallback(
    (hit: Hit) => {
      close();
      router.push(hit.href);
    },
    [close, router],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter" && hits[cursor]) {
      e.preventDefault();
      go(hits[cursor]);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Search the Business OS"
        className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-faint transition-colors hover:border-brand hover:text-fg"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
        </svg>
        <span className="hidden sm:inline">Search</span>
        <kbd className="hidden rounded border border-line px-1 font-sans text-[10px] md:inline">⌘K</kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-[120] overflow-y-auto overscroll-contain px-4 pb-8 pt-[10vh]">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={close} />
          <div className="relative mx-auto w-full max-w-xl">
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Search"
              className="overflow-hidden rounded-2xl border border-line bg-surface shadow-soft"
            >
              <div className="flex items-center gap-2 border-b border-line px-4">
                <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-faint" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
                </svg>
                <input
                  ref={inputRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Find a task, event, person, vendor…"
                  className="w-full bg-transparent py-3.5 text-sm text-fg outline-none placeholder:text-faint"
                />
                {searching && <span className="shrink-0 text-[11px] text-faint">…</span>}
              </div>

              <div className="max-h-[22rem] overflow-y-auto">
                {q.trim().length < 2 ? (
                  <p className="px-4 py-6 text-center text-xs text-faint">
                    Type at least two characters. A code like <span className="font-mono">T-014</span> jumps
                    straight to it.
                  </p>
                ) : hits.length === 0 && !searching ? (
                  <p className="px-4 py-6 text-center text-xs text-faint">
                    Nothing matching “{q.trim()}” that you can open.
                  </p>
                ) : (
                  <ul>
                    {hits.map((h, i) => (
                      <li key={`${h.kind}-${h.id}`}>
                        <button
                          onMouseEnter={() => setCursor(i)}
                          onClick={() => go(h)}
                          className={`flex w-full items-center gap-3 px-4 py-2.5 text-left ${
                            i === cursor ? "bg-surface-2" : ""
                          }`}
                        >
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${KIND_TONE[h.kind] ?? "bg-surface-2 text-muted"}`}>
                            {h.kind}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-fg">{h.title}</span>
                            {h.subtitle && (
                              <span className="block truncate text-[11px] text-faint">{h.subtitle}</span>
                            )}
                          </span>
                          {i === cursor && (
                            <span className="shrink-0 text-[10px] text-faint">↵</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-[10px] text-faint">
                <span>↑↓ to move</span>
                <span>↵ to open</span>
                <span>esc to close</span>
                <span className="ml-auto flex items-center gap-1">
                  <Icon name="users" className="h-3 w-3" strokeWidth={2} />
                  only what you can open
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
