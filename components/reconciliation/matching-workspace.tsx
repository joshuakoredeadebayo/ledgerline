"use client";

import { useTransition } from "react";
import { Check, X, GitMerge } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ConfidenceScore } from "@/components/reconciliation/confidence-score";
import { EmptyState } from "@/components/shared/empty-state";
import { formatCurrency, formatDate } from "@/lib/utils";
import { confirmMatch, rejectMatch } from "@/lib/actions/reconciliation";

interface TxnRow {
  id: string;
  amount: number;
  currency: string;
  transaction_date: string;
  description: string | null;
  source: string;
}

interface ExistingMatch {
  id: string;
  status: string;
  confidence_score: number | null;
  match_type: string;
  match_lines: { transaction_id: string; side: string; transactions: TxnRow }[];
}

export function MatchingWorkspace({
  accountId,
  currency,
  existingMatches,
  canMatch,
}: {
  accountId: string;
  currency: string;
  existingMatches: ExistingMatch[];
  canMatch: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  const hasSuggestions = existingMatches.length > 0;

  return (
    <div className="space-y-8">
      {hasSuggestions && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-ink-700">Suggested matches</h2>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Bank transaction</TableHeaderCell>
                <TableHeaderCell>Ledger transaction</TableHeaderCell>
                <TableHeaderCell>Confidence</TableHeaderCell>
                <TableHeaderCell className="text-right">Actions</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {existingMatches.map((match) => {
                const bank = match.match_lines.find((l) => l.side === "bank")?.transactions;
                const ledger = match.match_lines.find((l) => l.side === "ledger")?.transactions;
                if (!bank || !ledger) return null;
                return (
                  <TableRow key={match.id}>
                    <TxnCell txn={bank} currency={currency} />
                    <TxnCell txn={ledger} currency={currency} />
                    <TableCell>
                      <ConfidenceScore score={match.confidence_score ?? 0} />
                    </TableCell>
                    <TableCell numeric>
                      {canMatch && (
                        <MatchActions
                          onConfirm={() => startTransition(() => confirmMatch(match.id, accountId))}
                          onReject={() => startTransition(() => rejectMatch(match.id, accountId))}
                          pending={isPending}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </section>
      )}

      {!hasSuggestions && (
        <EmptyState
          icon={<GitMerge className="h-8 w-8" />}
          title="Nothing to match right now"
          description="Once transactions sync from your bank and ledger, unmatched items and suggestions will show up here."
        />
      )}
    </div>
  );
}

function TxnCell({ txn, currency }: { txn: TxnRow; currency: string }) {
  return (
    <TableCell>
      <div className="flex flex-col">
        <span className="font-medium tabular-nums text-ink-900">
          {formatCurrency(txn.amount, txn.currency ?? currency)}
        </span>
        <span className="text-xs text-ink-500">
          {formatDate(txn.transaction_date)} · {txn.description ?? "No description"}
        </span>
      </div>
    </TableCell>
  );
}

function MatchActions({
  onConfirm,
  onReject,
  pending,
}: {
  onConfirm: () => void;
  onReject: () => void;
  pending: boolean;
}) {
  return (
    <div className="flex justify-end gap-1.5">
      <Button size="sm" variant="secondary" onClick={onConfirm} disabled={pending}>
        <Check className="h-3.5 w-3.5" />
        Confirm
      </Button>
      <Button size="sm" variant="ghost" onClick={onReject} disabled={pending}>
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
