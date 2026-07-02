"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "./Icon";

type Notif = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
};

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function NotificationBell() {
  const supabase = createClient();
  const router = useRouter();
  const [items, setItems] = useState<Notif[]>([]);
  const [open, setOpen] = useState(false);
  const unread = items.filter((i) => !i.read).length;

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    setItems((data as Notif[]) ?? []);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next) await load();
  };

  const markAll = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    await supabase.from("notifications").update({ read: true }).eq("user_id", u.user.id).eq("read", false);
    setItems((list) => list.map((i) => ({ ...i, read: true })));
  };

  const onItem = async (n: Notif) => {
    if (!n.read) {
      await supabase.from("notifications").update({ read: true }).eq("id", n.id);
      setItems((list) => list.map((i) => (i.id === n.id ? { ...i, read: true } : i)));
    }
    setOpen(false);
    if (n.link) router.push(n.link);
  };

  return (
    <div className="relative">
      <button
        onClick={toggle}
        aria-label="Notifications"
        className="relative rounded-lg p-2 text-muted transition-colors hover:bg-ink-2 hover:text-fg"
      >
        <Icon name="bell" className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-line bg-surface shadow-soft">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="text-sm font-semibold text-fg">Notifications</span>
              {unread > 0 && (
                <button onClick={markAll} className="text-xs font-medium text-brand-soft hover:underline">
                  Mark all read
                </button>
              )}
            </div>
            <div className="max-h-96 overflow-y-auto">
              {items.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-muted">
                  You&apos;re all caught up.
                </p>
              ) : (
                items.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => onItem(n)}
                    className={`flex w-full flex-col gap-0.5 border-b border-line px-4 py-3 text-left transition-colors last:border-0 hover:bg-ink-2 ${n.read ? "" : "bg-brand/5"}`}
                  >
                    <span className="text-sm font-medium text-fg">{n.title}</span>
                    {n.body && <span className="text-xs text-muted">{n.body}</span>}
                    <span className="text-[10px] text-faint">{timeAgo(n.created_at)}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
