"use client";

import { useState, useTransition } from "react";
import { toast } from "@/components/Toast";
import { Card, EmptyState } from "@/components/os/ui";
import { inr, shortDate } from "@/lib/bos";
import { decideApproval } from "./actions";

export type Approval = {
  id: string;
  request_type: string;
  request_title: string;
  requester_id: string | null;
  approver_id: string | null;
  amount: number;
  decision: "pending" | "approved" | "rejected";
  decided_at: string | null;
  comments: string | null;
  created_at: string;
};

type Owner = { id: string; full_name: string | null; email: string | null };

export function ApprovalsWorkflow({ rows, owners }: { rows: Approval[]; owners: Owner[] }) {
  const [comment, setComment] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const name = (id: string | null) =>
    owners.find((o) => o.id === id)?.full_name || owners.find((o) => o.id === id)?.email || "—";

  const pendingRows = rows.filter((r) => r.decision === "pending");

  const decide = (r: Approval, decision: "approved" | "rejected") => {
    start(async () => {
      const res = await decideApproval(r.id, decision, comment[r.id]);
      if (res?.error) toast(res.error, "error");
      else toast(`Request ${decision}`, "success");
    });
  };

  return (
    <>
      <div className="mb-4">
        <h1 className="font-display text-2xl font-bold tracking-tight text-fg">Approvals</h1>
        <p className="text-sm text-muted">
          {pendingRows.length > 0
            ? `${pendingRows.length} request${pendingRows.length === 1 ? "" : "s"} awaiting your decision.`
            : "No pending requests."}
        </p>
      </div>

      {pendingRows.length === 0 ? (
        <EmptyState title="Nothing to approve" hint="New requests appear here for approve / reject." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {pendingRows.map((r) => (
            <Card key={r.id}>
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <span className="rounded-full bg-ink-2 px-2 py-0.5 text-[11px] font-medium text-muted">{r.request_type}</span>
                  <p className="mt-1 font-medium text-fg">{r.request_title}</p>
                  <p className="text-xs text-muted">
                    From {name(r.requester_id)} · {shortDate(r.created_at)}
                    {r.amount > 0 && <> · {inr(r.amount)}</>}
                  </p>
                </div>
              </div>
              <input
                value={comment[r.id] ?? ""}
                onChange={(e) => setComment({ ...comment, [r.id]: e.target.value })}
                placeholder="Comment (optional)"
                className="mb-2 w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-fg outline-none focus:border-brand"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => decide(r, "approved")}
                  disabled={pending}
                  className="flex-1 rounded-full bg-green-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
                >
                  Approve
                </button>
                <button
                  onClick={() => decide(r, "rejected")}
                  disabled={pending}
                  className="flex-1 rounded-full border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 disabled:opacity-60"
                >
                  Reject
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
