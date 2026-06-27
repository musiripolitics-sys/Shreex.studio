"use client";

import { useEffect, useState, useCallback } from "react";

type ToastType = "success" | "error" | "info";
type ToastItem = { id: number; message: string; type: ToastType };

/** Fire a toast from anywhere on the client: toast("Saved!", "success"). */
export function toast(message: string, type: ToastType = "info") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("txf:toast", { detail: { message, type } }),
  );
}

const styles: Record<ToastType, string> = {
  success: "border-host/40 bg-host/10 text-host-soft",
  error: "border-red-500/30 bg-red-500/10 text-red-600",
  info: "border-line bg-surface text-fg",
};

const icons: Record<ToastType, string> = {
  success: "✓",
  error: "!",
  info: "i",
};

/** Mounts once (in the root layout) and renders the toast stack. */
export function Toaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const { message, type } = (e as CustomEvent).detail as {
        message: string;
        type: ToastType;
      };
      const id = Date.now() + Math.random();
      setToasts((t) => [...t, { id, message, type }]);
      setTimeout(() => remove(id), 4500);
    };
    window.addEventListener("txf:toast", handler);
    return () => window.removeEventListener("txf:toast", handler);
  }, [remove]);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => remove(t.id)}
          className={`flex w-full max-w-sm cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-soft backdrop-blur transition-all ${styles[t.type]}`}
        >
          <span
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
              t.type === "success"
                ? "bg-host/20"
                : t.type === "error"
                  ? "bg-red-500/20"
                  : "bg-ink-2"
            }`}
            aria-hidden
          >
            {icons[t.type]}
          </span>
          <span className="flex-1">{t.message}</span>
        </div>
      ))}
    </div>
  );
}
