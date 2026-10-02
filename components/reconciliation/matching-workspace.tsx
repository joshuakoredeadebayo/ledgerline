"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Check, X, GitMerge } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ConfidenceScore } from "@/components/reconciliation/confidence-score";
import { EmptyState } from "@/components/shared/empty-state";
import { formatCurrency, formatDate } from "@/lib/utils";
import { confirmMatch, rejectMatch, createManualMatch } from "@/lib/actions/reconciliation";

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
  entityId,
  currency,
  existingMatches,
  unmatchedBank,
  unmatchedLedger,
  canMatch,
}: {
  accountId: string;
  entityId: string;
  currency: string;
  existingMatches: ExistingMatch[];
  unmatchedBank: TxnRow[];
  unmatchedLedger: TxnRow[];
  canMatch: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [selectedBankId, setSelectedBankId] = useState<string | null>(null);
  const [selectedLedgerId, setSelectedLedgerId] = useState<string | null>(null);

  const hasSuggestions = existingMatches.length > 0;
  const hasUnmatched = unmatchedBank.length > 0 || unmatchedLedger.length > 0;

  // Both sides use one sign convention: positive = money leaving the
  // account, negative = money coming in. Pairing an outflow with an inflow
  // is almost always a mistake, so warn before allowing it.
  const selectedBank = unmatchedBank.find((t) => t.id === selectedBankId);
  const selectedLedger = unmatchedLedger.find((t) => t.id === selectedLedgerId);
  const oppositeSigns =
    !!selectedBank && !!selectedLedger && Math.sign(Number(selectedBank.amount)) !== Math.sign(Number(selectedLedger.amount));
  const directionOf = (t: TxnRow) => (Number(t.amount) < 0 ? "money coming in" : "money going out");

  const handleManualMatch = () => {
    if (!selectedBankId || !selectedLedgerId) return;
    startTransition(async () => {
      await createManualMatch(entityId, accountId, selectedBankId, selectedLedgerId);
      setSelectedBankId(null);
      setSelectedLedgerId(null);
    });
  };

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

      {hasUnmatched && (
        <section>
          <h2 className="mb-1 text-sm font-semibold text-ink-700">Unmatched transactions</h2>
          <p className="mb-3 text-sm text-ink-500">
            No suggested pairing was found for these — select one from each side to match them manually.
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <UnmatchedList
              label="Bank"
              txns={unmatchedBank}
              currency={currency}
              selectedId={selectedBankId}
              onSelect={canMatch ? setSelectedBankId : undefined}
            />
            <UnmatchedList
              label="Ledger"
              txns={unmatchedLedger}
              currency={currency}
              selectedId={selectedLedgerId}
              onSelect={canMatch ? setSelectedLedgerId : undefined}
            />
          </div>
          {canMatch && (
            <div className="mt-3 space-y-3">
              {oppositeSigns && selectedBank && selectedLedger && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-status-pending/40 bg-status-pendingBg px-3 py-2 text-sm text-ink-800"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-pending" />
                  <p>
                    <span className="font-medium">Opposite directions.</span> The bank transaction (
                    {formatCurrency(selectedBank.amount, selectedBank.currency ?? currency)}) is {directionOf(selectedBank)},
                    but the ledger entry ({formatCurrency(selectedLedger.amount, selectedLedger.currency ?? currency)}) is{" "}
                    {directionOf(selectedLedger)}. Matching them will usually leave the period out of balance. Check
                    the sign of the ledger entry before continuing.
                  </p>
                </div>
              )}
              <Button
                size="sm"
                variant={oppositeSigns ? "destructive" : "primary"}
                onClick={handleManualMatch}
                disabled={!selectedBankId || !selectedLedgerId || isPending}
              >
                <GitMerge className="h-3.5 w-3.5" />
                {oppositeSigns ? "Match anyway" : "Match selected"}
              </Button>
            </div>
          )}
        </section>
      )}

      {!hasSuggestions && !hasUnmatched && (
        <EmptyState
          icon={<GitMerge className="h-8 w-8" />}
          title="Nothing to match right now"
          description="Once transactions sync from your bank and ledger, unmatched items and suggestions will show up here."
        />
      )}
    </div>
  );
}

function UnmatchedList({
  label,
  txns,
  currency,
  selectedId,
  onSelect,
}: {
  label: string;
  txns: TxnRow[];
  currency: string;
  selectedId: string | null;
  onSelect?: (id: string) => void;
}) {
  return (
    <div className="rounded-md border border-ink-100">
      <div className="border-b border-ink-100 bg-ink-50 px-3 py-2 text-xs font-medium uppercase tracking-wide text-ink-500">
        {label} ({txns.length})
      </div>
      <div className="max-h-72 overflow-y-auto">
        {txns.length === 0 && <p className="p-3 text-sm text-ink-400">None unmatched.</p>}
        {txns.map((txn) => {
          const isSelected = txn.id === selectedId;
          return (
            <button
              key={txn.id}
              type="button"
              disabled={!onSelect}
              onClick={() => onSelect?.(txn.id)}
              className={`flex w-full flex-col border-b border-ink-50 px-3 py-2 text-left last:border-b-0 ${
                isSelected ? "bg-accent-50" : "hover:bg-ink-50"
              } ${!onSelect ? "cursor-default" : "cursor-pointer"}`}
            >
              <span className="font-medium tabular-nums text-ink-900">
                {formatCurrency(txn.amount, txn.currency ?? currency)}
              </span>
              <span className="text-xs text-ink-500">
                {formatDate(txn.transaction_date)} · {txn.description ?? "No description"}
              </span>
            </button>
          );
        })}
      </div>
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