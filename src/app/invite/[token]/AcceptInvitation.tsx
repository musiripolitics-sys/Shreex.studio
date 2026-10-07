"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/Toast";
import { acceptInvitation } from "@/app/admin/os/actions";

/**
 * The accept button.
 *
 * A client component for one reason: after accepting, the person has to land
 * inside the business they just joined, and that is a router push the server
 * action cannot do for them.
 */
export function AcceptInvitation({ token, business }: { token: string; business: string }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  const router = useRouter();

  if (done) {
    return (
      <p className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        You have joined {business}. Taking you there…
      </p>
    );
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await acceptInvitation(token);
          if ("error" in res && res.error) return toast(res.error, "error");
          setDone(true);
          toast(`You have joined ${business}`, "success");
          router.push("/admin/os");
        })
      }
      className="mt-5 w-full rounded-full bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
    >
      {pending ? "Joining…" : `Accept and join ${business}`}
    </button>
  );
}
