"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const urlMode = params.get("mode");

  const [mode, setMode] = useState<"signin" | "signup" | "reset">(
    urlMode === "signup" ? "signup" : "signin"
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [role, setRole] = useState<"community_member" | "event_host">(
    "community_member",
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(params.get("error"));
  const [notice, setNotice] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);

    const supabase = createClient();

    if (mode === "reset") {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email,
        {
          redirectTo: `${window.location.origin}/auth/confirm?next=/account/new-password`,
        },
      );
      setLoading(false);
      if (resetError) return setError(resetError.message);
      setNotice(
        "If an account exists for that email, we've sent a password reset link. Check your inbox.",
      );
      return;
    }

    if (mode === "signup") {
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName, phone, city, role } },
      });
      setLoading(false);
      if (signUpError) return setError(signUpError.message);
      setNotice(
        role === "event_host"
          ? "Account created as a Community Member. Your Host access is pending admin approval — you'll get host features once approved. Sign in below."
          : "Account created. If email confirmation is on, check your inbox — otherwise sign in below.",
      );
      setMode("signin");
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setLoading(false);
    if (signInError) return setError(signInError.message);

    router.push(next);
    router.refresh();
  };

  const isAdminPath = next.startsWith("/admin");

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-5 py-16">
      <h1 className="font-display text-3xl font-bold tracking-tight text-fg">
        {mode === "signin"
          ? "Sign in"
          : mode === "signup"
            ? "Create account"
            : "Reset password"}
      </h1>
      <p className="mt-2 text-sm text-muted">
        {mode === "reset"
          ? "Enter your email and we'll send you a link to reset your password."
          : mode === "signin"
            ? isAdminPath
              ? "Access the Techxfluence admin console."
              : "Sign in to access your membership perks and events."
            : isAdminPath
              ? "Sign up, then ask an admin to grant you access."
              : "Sign up to join our community and access events."}
      </p>

      <form
        onSubmit={handleSubmit}
        className="mt-8 space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-soft"
      >
        {mode === "signup" && (
          <>
            <Input
              label="Full name"
              value={fullName}
              onChange={setFullName}
              placeholder="Your name"
              required
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Phone"
                type="tel"
                value={phone}
                onChange={setPhone}
                placeholder="+91 …"
              />
              <Input
                label="City"
                value={city}
                onChange={setCity}
                placeholder="Chennai"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-fg">
                I want to join as
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setRole("community_member")}
                  className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                    role === "community_member"
                      ? "border-brand bg-brand/5"
                      : "border-line bg-ink hover:border-brand/40"
                  }`}
                >
                  <span className="block text-sm font-semibold text-fg">
                    Community Member
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">
                    Discover & attend events
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setRole("event_host")}
                  className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                    role === "event_host"
                      ? "border-brand bg-brand/5"
                      : "border-line bg-ink hover:border-brand/40"
                  }`}
                >
                  <span className="block text-sm font-semibold text-fg">Host</span>
                  <span className="mt-0.5 block text-xs text-muted">
                    Create & run events
                  </span>
                </button>
              </div>
            </div>
          </>
        )}
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="you@email.com"
          required
        />
        {mode !== "reset" && (
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="••••••••"
            required
          />
        )}

        {mode === "signin" && (
          <button
            type="button"
            onClick={() => {
              setMode("reset");
              setError(null);
              setNotice(null);
            }}
            className="block text-xs text-muted hover:text-fg"
          >
            Forgot password?
          </button>
        )}

        {error && (
          <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
            {error}
          </p>
        )}
        {notice && (
          <p className="rounded-xl border border-host/40 bg-host/10 px-4 py-3 text-sm text-host-soft">
            {notice}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-full bg-brand px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-brand-soft disabled:opacity-60"
        >
          {loading
            ? "Please wait…"
            : mode === "signin"
              ? "Sign in"
              : mode === "signup"
                ? "Create account"
                : "Send reset link"}
        </button>
      </form>

      <button
        onClick={() => {
          setMode(
            mode === "signin" ? "signup" : mode === "signup" ? "signin" : "signin",
          );
          setError(null);
          setNotice(null);
        }}
        className="mt-5 text-center text-sm text-muted hover:text-fg"
      >
        {mode === "signin"
          ? "Need an account? Sign up"
          : mode === "signup"
            ? "Already have an account? Sign in"
            : "← Back to sign in"}
      </button>

      <Link href="/" className="mt-3 text-center text-xs text-faint hover:text-muted">
        ← Back to site
      </Link>
    </div>
  );
}

function Input({
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-fg">{label}</label>
      <input
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-line bg-ink px-4 py-3 text-sm text-fg placeholder:text-faint focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
      />
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
