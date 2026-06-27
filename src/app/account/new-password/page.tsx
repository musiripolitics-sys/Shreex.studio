"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function NewPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      return setError("Password must be at least 8 characters.");
    }
    if (password !== confirm) {
      return setError("Passwords don't match.");
    }

    setLoading(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      // No recovery session usually means the link expired or was already used.
      return setError(
        updateError.message.includes("session")
          ? "Your reset link has expired. Please request a new one."
          : updateError.message,
      );
    }
    setDone(true);
    setTimeout(() => {
      router.push("/profile");
      router.refresh();
    }, 1500);
  };

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-5 py-16">
      <h1 className="font-display text-3xl font-bold tracking-tight text-fg">
        Set a new password
      </h1>
      <p className="mt-2 text-sm text-muted">
        Choose a new password for your Techxfluence account.
      </p>

      {done ? (
        <div className="mt-8 rounded-2xl border border-host/40 bg-host/10 px-4 py-4 text-sm text-host-soft">
          Password updated. Redirecting you to your profile…
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="mt-8 space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-soft"
        >
          <div>
            <label className="mb-1.5 block text-sm font-medium text-fg">
              New password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-xl border border-line bg-ink px-4 py-3 text-sm text-fg placeholder:text-faint focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-fg">
              Confirm password
            </label>
            <input
              type="password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-xl border border-line bg-ink px-4 py-3 text-sm text-fg placeholder:text-faint focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>

          {error && (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full bg-brand px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-brand-soft disabled:opacity-60"
          >
            {loading ? "Updating…" : "Update password"}
          </button>
        </form>
      )}

      <Link
        href="/login"
        className="mt-3 text-center text-xs text-faint hover:text-muted"
      >
        ← Back to sign in
      </Link>
    </div>
  );
}
