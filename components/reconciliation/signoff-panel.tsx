"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { approveAndFinalize, requestChanges, submitForReview, withdrawReview } from "@/lib/actions/signoff";
import { Button } from "@/components/ui/button";

export interface SignoffState {
  reconciliationId: string;
  status: string;
  reviewStatus: "pending" | "changes_requested" | "approved" | null;
  reviewNote: string | null;
  submittedBy: string | null;
  reviewerId: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

const field =
  "h-9 w-full rounded border border-ink-200 bg-white px-2.5 text-sm text-ink-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500";

const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/**
 * Preparer-and-reviewer sign-off. The person who prepared a period submits it to a named reviewer;
 * the reviewer, who must be someone else, approves and finalizes it or sends it back with a reason.
 */
export function SignoffPanel({
  state,
  userId,
  isOwner,
  canPrepare,
  canReview,
  reviewers,
  names,
}: {
  state: SignoffState;
  userId: string;
  isOwner: boolean;
  canPrepare: boolean;
  canReview: boolean;
  reviewers: { id: string; email: string }[];
  names: Record<string, string>;
}) {
  const router = useRouter();
  const [reviewerId, setReviewerId] = useState(reviewers[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (work: () => Promise<{ error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await work();
      if (res.error) setError(res.error);
      else {
        setNote("");
        router.refresh();
      }
    });
  };

  const name = (id: string | null) => (id ? (names[id] ?? "a former member") : "—");
  const isSubmitter = state.submittedBy === userId;
  const isAssignedReviewer = canReview && !isSubmitter && (state.reviewerId === userId || isOwner);

  let body: React.ReactNode;

  if (state.status === "finalized") {
    body = (
      <p className="text-sm text-ink-700">
        Prepared by <span className="font-medium text-ink-900">{name(state.submittedBy)}</span>, reviewed and approved by{" "}
        <span className="font-medium text-ink-900">{name(state.reviewedBy)}</span>
        {state.reviewedAt ? ` on ${fmt(state.reviewedAt)}` : ""}.
      </p>
    );
  } else if (state.status !== "reconciled") {
    body = <p className="text-sm text-ink-500">Sign-off opens once this period is fully reconciled, with nothing left unexplained.</p>;
  } else if (state.reviewStatus === "pending") {
    body = (
      <div className="space-y-3">
        <p className="text-sm text-ink-700">
          Submitted by <span className="font-medium text-ink-900">{name(state.submittedBy)}</span>. Waiting for{" "}
          <span className="font-medium text-ink-900">{name(state.reviewerId)}</span> to review it.
          {state.reviewNote ? <span className="mt-1 block text-ink-500">Note from the preparer: {state.reviewNote}</span> : null}
        </p>
        {isAssignedReviewer && (
          <div className="space-y-2 rounded-lg bg-ink-50 p-3">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Add a note (required if you are sending it back)"
              className="w-full rounded border border-ink-200 p-2.5 text-sm text-ink-900 placeholder:text-ink-400 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
            />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" loading={pending} onClick={() => run(() => approveAndFinalize({ reconciliationId: state.reconciliationId, note }))}>
                Approve and finalize
              </Button>
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => requestChanges({ reconciliationId: state.reconciliationId, note }))}>
                Send back for changes
              </Button>
            </div>
          </div>
        )}
        {isSubmitter && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => withdrawReview(state.reconciliationId))}>
            Withdraw submission
          </Button>
        )}
      </div>
    );
  } else if (canPrepare) {
    body = (
      <div className="space-y-3">
        {state.reviewStatus === "changes_requested" && (
          <p className="rounded-lg border border-status-pending/30 bg-status-pendingBg px-4 py-3 text-sm text-ink-800">
            <span className="font-medium">{name(state.reviewedBy)} sent this back:</span> {state.reviewNote}
          </p>
        )}
        {reviewers.length === 0 ? (
          <p className="text-sm text-ink-500">There is nobody else who can review. Invite a controller or owner under Settings → Members.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
              Reviewer
              <select value={reviewerId} onChange={(e) => setReviewerId(e.target.value)} className={field}>
                {reviewers.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.email}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-700 sm:col-span-2">
              Note for the reviewer (optional)
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={field} />
            </label>
          </div>
        )}
        {reviewers.length > 0 && (
          <Button size="sm" loading={pending} onClick={() => run(() => submitForReview({ reconciliationId: state.reconciliationId, reviewerId, note }))}>
            {state.reviewStatus === "changes_requested" ? "Submit again for review" : "Submit for review"}
          </Button>
        )}
      </div>
    );
  } else {
    body = <p className="text-sm text-ink-500">This period is ready. Someone who prepares reconciliations needs to submit it for review.</p>;
  }

  return (
    <section className="space-y-3 rounded-xl border border-ink-100 bg-white p-5 shadow-subtle">
      <div>
        <h2 className="text-[15px] font-semibold text-ink-900">Sign-off</h2>
        <p className="mt-0.5 text-xs text-ink-500">Your organization requires a second person to review and approve a reconciliation before it is finalized.</p>
      </div>
      {body}
      {error && (
        <p role="alert" className="text-sm text-status-exception">
          {error}
        </p>
      )}
    </section>
  );
}
