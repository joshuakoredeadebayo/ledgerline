"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { closeException, reopenException, type ExceptionOutcome } from "@/lib/actions/exceptions";
import { DISMISS_REASONS, RESOLVE_REASONS } from "@/lib/exception-reasons";
import { Modal, ModalContent } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

/** Resolve / Dismiss (with a reason) for an open exception, Reopen for a closed one, plus a link to the account. */
export function ExceptionActions({
  exceptionId,
  status,
  canAct,
  reviewHref,
  adjustHref,
}: {
  exceptionId: string;
  status: "open" | "resolved" | "dismissed";
  canAct: boolean;
  reviewHref: string;
  /** Opens a pre-filled journal entry for a bank item that hasn't been booked yet. */
  adjustHref?: string;
}) {
  const [mode, setMode] = useState<ExceptionOutcome | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const reasons = mode === "dismissed" ? DISMISS_REASONS : RESOLVE_REASONS;

  const open = (next: ExceptionOutcome) => {
    setMode(next);
    setReason(next === "dismissed" ? DISMISS_REASONS[0] : RESOLVE_REASONS[0]);
    setNote("");
    setError(null);
  };

  const submit = () => {
    if (!mode) return;
    setError(null);
    startTransition(async () => {
      const res = await closeException(exceptionId, mode, reason, note);
      if (res.error) setError(res.error);
      else setMode(null);
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-1">
        <Link href={reviewHref} className="inline-flex h-8 items-center rounded px-3 text-sm font-medium text-accent-600 hover:bg-accent-50">
          Review
        </Link>
        {canAct && status === "open" && adjustHref && (
          <Link href={adjustHref} className="inline-flex h-8 items-center rounded px-3 text-sm font-medium text-accent-600 hover:bg-accent-50" title="Record a journal entry for this bank item">
            Adjust
          </Link>
        )}
        {canAct && status === "open" && (
          <>
            <Button type="button" size="sm" variant="secondary" onClick={() => open("resolved")}>
              Resolve
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => open("dismissed")}>
              Dismiss
            </Button>
          </>
        )}
        {canAct && status !== "open" && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const res = await reopenException(exceptionId);
                if (res.error) setError(res.error);
              });
            }}
          >
            Reopen
          </Button>
        )}
      </div>
      {error && mode === null && <p className="max-w-[16rem] text-right text-xs text-status-exception">{error}</p>}

      <Modal open={mode !== null} onOpenChange={(o) => !o && setMode(null)}>
        <ModalContent
          title={mode === "dismissed" ? "Dismiss this exception" : "Resolve this exception"}
          description={
            mode === "dismissed"
              ? "Use this when it isn't a real issue, such as a duplicate or test data. The reason is kept in the audit log."
              : "Use this when you understand the item and it needs no further action in this period. It then stops counting toward the unexplained difference. The reason is kept in the audit log."
          }
        >
          <div className="space-y-4">
            <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
              Reason
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="h-9 rounded border border-ink-200 bg-white px-3 text-sm font-normal text-ink-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
              >
                {reasons.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
              Note {reason === "Other" ? "(required)" : "(optional)"}
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                maxLength={500}
                className="rounded border border-ink-200 p-2 text-sm font-normal text-ink-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-status-exception">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setMode(null)}>
                Cancel
              </Button>
              <Button type="button" loading={pending} onClick={submit}>
                {mode === "dismissed" ? "Dismiss" : "Resolve"}
              </Button>
            </div>
          </div>
        </ModalContent>
      </Modal>
    </div>
  );
}
