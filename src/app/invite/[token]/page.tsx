import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { AcceptInvitation } from "./AcceptInvitation";

export const metadata = { title: "Invitation · Techxfluence", robots: { index: false } };

type Preview = {
  found: boolean;
  tenant_name?: string;
  tenant_ok?: boolean;
  role?: string;
  sections?: string[];
  email?: string;
  expired?: boolean;
  accepted?: boolean;
  is_you?: boolean | null;
};

/**
 * Joining a business from an invitation link.
 *
 * 0047 built bos_invite_to_tenant and bos_accept_invitation and no route to
 * reach either, so a token could be issued and never redeemed — the whole
 * invitation flow was a dead end. This is the redeeming half.
 *
 * Deliberately outside /admin/os. Somebody invited to a business is not a
 * member of it yet, so the OS layout would bounce them to a dashboard they
 * cannot see before they had a chance to accept.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createClient();
  const user = await getCurrentUser();

  const { data, error } = await supabase.rpc("bos_invitation_preview", { p_token: token });
  const preview = (data ?? null) as Preview | null;

  // A database without 0051 has no preview function. Rather than show nothing,
  // fall through to a bare accept — bos_accept_invitation is what decides, and
  // it exists from 0047.
  const unknown = !!error || !preview;

  if (!unknown && preview && !preview.found) {
    return (
      <Shell title="That link is not an invitation">
        <p className="text-sm text-muted">
          It may have been withdrawn, or already replaced by a newer one. Ask whoever
          invited you to send another.
        </p>
      </Shell>
    );
  }

  const name = preview?.tenant_name ?? "a business";

  if (preview?.accepted) {
    return (
      <Shell title={`You have already joined ${name}`}>
        <p className="text-sm text-muted">This invitation has been used.</p>
        <Link href="/admin/os" className="mt-4 inline-block rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white">
          Open the Business OS
        </Link>
      </Shell>
    );
  }

  if (preview?.expired) {
    return (
      <Shell title="That invitation has expired">
        <p className="text-sm text-muted">
          Invitations last fourteen days. Ask whoever invited you to {name} to send a new one —
          it issues a fresh link and retires this one.
        </p>
      </Shell>
    );
  }

  if (preview && preview.tenant_ok === false) {
    return (
      <Shell title={`${name} is not active`}>
        <p className="text-sm text-muted">
          That business has been suspended, so there is nothing to join yet.
        </p>
      </Shell>
    );
  }

  // Not signed in: say what the invitation is for, then send them to sign in
  // and come straight back here.
  if (!user) {
    const next = encodeURIComponent(`/invite/${token}`);
    return (
      <Shell title={`You have been invited to ${name}`}>
        {preview?.email && (
          <p className="text-sm text-muted">
            The invitation was sent to <strong className="text-fg">{preview.email}</strong>. Sign in
            as that address to accept it — an invitation belongs to an address, not to whoever has
            the link.
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={`/login?next=${next}`} className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white">
            Sign in
          </Link>
          <Link href={`/login?mode=signup&next=${next}`} className="rounded-full border border-line px-4 py-2 text-sm font-medium text-muted hover:border-brand hover:text-brand">
            Create an account
          </Link>
        </div>
      </Shell>
    );
  }

  // Signed in as somebody else. Nothing to do but say so clearly, because
  // bos_accept_invitation will refuse it.
  if (preview?.is_you === false) {
    return (
      <Shell title="This invitation is for a different address">
        <p className="text-sm text-muted">
          It was sent to <strong className="text-fg">{preview.email}</strong>, and you are signed in
          as <strong className="text-fg">{user.email}</strong>. An invitation belongs to an
          address, not to whoever holds the link, so this one has to be accepted by that account.
        </p>
        <Link
          href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
          className="mt-4 inline-block rounded-full border border-line px-4 py-2 text-sm font-medium text-muted hover:border-brand hover:text-brand"
        >
          Sign in as {preview.email}
        </Link>
      </Shell>
    );
  }

  return (
    <Shell title={`Join ${name}`}>
      <p className="text-sm text-muted">
        You have been invited to {name}
        {preview?.role && <> as {describeRole(preview.role)}</>}.
        {preview?.sections && preview.sections.length > 0 && (
          <> You will be able to open {preview.sections.length} section
            {preview.sections.length === 1 ? "" : "s"} of its Business OS.</>
        )}
      </p>
      <p className="mt-2 text-xs text-faint">
        Accepting adds you to {name} and takes you there. It does not affect any other business
        you belong to.
      </p>
      <AcceptInvitation token={token} business={name} />
      {unknown && (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Migration 0051 has not run, so the details above could not be read. Accepting still
          works — the database checks the token either way.
        </p>
      )}
    </Shell>
  );
}

function describeRole(role: string): string {
  if (role === "admin") return "an admin";
  if (role === "event_host") return "an event host";
  if (role === "community_member") return "a community member";
  return `a${/^[aeiou]/.test(role) ? "n" : ""} ${role.replace(/_/g, " ")}`;
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-lg flex-col justify-center px-5 py-16">
      <div className="rounded-2xl border border-line bg-surface p-6 shadow-soft">
        <h1 className="font-display text-xl font-bold text-fg">{title}</h1>
        <div className="mt-2">{children}</div>
      </div>
      <Link href="/" className="mt-4 self-start text-xs text-faint hover:text-fg">
        ← Back to site
      </Link>
    </main>
  );
}

// An invitation URL is unguessable and single use, so it is never indexed.
export const dynamic = "force-dynamic";
