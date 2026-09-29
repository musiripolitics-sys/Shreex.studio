"use client";

import { type ReactNode } from "react";
import { useDialogChrome } from "./useDialogChrome";

/** Lightweight accessible modal used by the Business OS record editors. */
export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useDialogChrome(open, onClose);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto overscroll-contain p-4 sm:p-8">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      {/* A dialog taller than the viewport has to start at the top and scroll.
          `my-auto` would centre it and put its own header out of reach. */}
      <div className="relative flex min-h-full items-center justify-center">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className={`w-full ${wide ? "max-w-3xl" : "max-w-lg"} rounded-2xl border border-line bg-surface p-6 shadow-soft`}
        >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold text-fg">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-ink-2 hover:text-fg"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
          {children}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── form field primitives ───────────────────────────

const labelCls = "block text-xs font-semibold uppercase tracking-wider text-faint mb-1";
const controlCls =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-brand";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      {children}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${controlCls} ${props.className ?? ""}`} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${controlCls} ${props.className ?? ""}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${controlCls} ${props.className ?? ""}`} />;
}

export function FormActions({
  onCancel,
  saving,
  submitLabel = "Save",
}: {
  onCancel: () => void;
  saving: boolean;
  submitLabel?: string;
}) {
  return (
    <div className="mt-5 flex justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        className="rounded-full border border-line px-4 py-2 text-sm font-medium text-muted transition-colors hover:text-fg"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={saving}
        className="rounded-full bg-brand px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-60"
      >
        {saving ? "Saving…" : submitLabel}
      </button>
    </div>
  );
}
