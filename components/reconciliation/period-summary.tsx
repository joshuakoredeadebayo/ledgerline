"use client";

import { useState, useTransition } from "react";
import { Lock, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, type BadgeStatus } from "@/components/ui/badge";
import { Modal, ModalTrigger, ModalContent } from "@/components/ui/modal";
import { formatCurrency, formatDate } from "@/lib/utils";
import { finalizeReconciliation, reopenReconciliation } from "@/lib/actions/reconciliation";

type Status = "draft" | "needs_review" | "reconciled" | "finalized" | "reopened";

interface PeriodSummaryProps {
  reconciliationId: string;
  accountId: string;
  status: Status;
  periodStart: string;
  periodEnd: string;
  bookTotal: number;
  externalTotal: number;
  difference: number;
  currency: string;
  finalizedAt: string | null;
  canFinalize: boolean;
}

const STATUS_META: Record<Status, { status: BadgeStatus; label: string }> = {
  draft: { status: "neutral", label: "Draft" },
  needs_review: { status: "pending", label: "Needs review" },
  reconciled: { status: "matched", label: "Reconciled — ready to finalize" },
  finalized: { status: "matched", label: "Finalized" },
  reopened: { status: "exception", label: "Reopened" },
};

export function PeriodSummary({
  reconciliationId,
  accountId,
  status,
  periodStart,
  periodEnd,
  bookTotal,
  externalTotal,
  difference,
  currency,
  finalizedAt,
  canFinalize,
}: PeriodSummaryProps) {
  const [isPending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [reopenOpen, setReopenOpen] = useState(false);
  const meta = STATUS_META[status];

  return (
    <div className="rounded-lg border border-ink-100 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-400">
            {formatDate(periodStart)} – {formatDate(periodEnd)}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <Badge status={meta.status} label={meta.label} />
            {status === "finalized" && finalizedAt && (
              <span className="text-xs text-ink-500">on {formatDate(finalizedAt)}</span>
            )}
          </div>
        </div>

        {canFinalize && status === "reconciled" && (
          <Button
            size="sm"
            loading={isPending}
            onClick={() => startTransition(() => finalizeReconciliation(reconciliationId, accountId))}
          >
            <Lock className="h-3.5 w-3.5" />
            Finalize period
          </Button>
        )}

        {canFinalize && status === "finalized" && (
          <Modal open={reopenOpen} onOpenChange={setReopenOpen}>
            <ModalTrigger asChild>
              <Button size="sm" variant="secondary">
                <RotateCcw className="h-3.5 w-3.5" />
                Reopen
              </Button>
            </ModalTrigger>
            <ModalContent
              title="Reopen this period"
              description="Reopening a finalized period requires a documented reason — this is recorded in the audit log."
            >
              <div className="flex flex-col gap-3">
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="Why does this period need to be reopened?"
                  className="rounded border border-ink-200 p-2 text-sm focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                />
                <Button
                  loading={isPending}
                  onClick={() =>
                    startTransition(async () => {
                      await reopenReconciliation(reconciliationId, accountId, reason);
                      setReopenOpen(false);
                    })
                  }
                >
                  Confirm reopen
                </Button>
              </div>
            </ModalContent>
          </Modal>
        )}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-4 border-t border-ink-100 pt-4 text-sm">
        <div>
          <p className="text-ink-500">Book total</p>
          <p className="mt-0.5 font-medium tabular-nums text-ink-900">{formatCurrency(bookTotal, currency)}</p>
        </div>
        <div>
          <p className="text-ink-500">External (bank) total</p>
          <p className="mt-0.5 font-medium tabular-nums text-ink-900">{formatCurrency(externalTotal, currency)}</p>
        </div>
        <div>
          <p className="text-ink-500">Unexplained difference</p>
          <p
            className={`mt-0.5 font-medium tabular-nums ${
              difference === 0 ? "text-status-matched" : "text-status-exception"
            }`}
          >
            {formatCurrency(difference, currency)}
          </p>
        </div>
      </div>
    </div>
  );
}
