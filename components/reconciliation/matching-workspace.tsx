"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Check, X, GitMerge } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ConfidenceScore } from "@/components/reconciliation/confidence-score";
import { EmptyState } from "@/components/shared/empty-state";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  confirmMatch,
  rejectMatch,
  createManualMatch,
  unmatchMatch,
  excludeTransaction,
  restoreTransaction,
} from "@/lib/actions/reconciliation";
import { EXCLUDE_REASONS } from "@/lib/exception-reasons";

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
  confirmedMatches,
  excludedTxns,
  unmatchedBank,
  unmatchedLedger,
  canMatch,
}: {
  accountId: string;
  entityId: string;
  currency: string;
  existingMatches: ExistingMatch[];
  confirmedMatches: ExistingMatch[];
  excludedTxns: TxnRow[];
  unmatchedBank: TxnRow[];
  unmatchedLedger: TxnRow[];
  canMatch: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [selectedBankId, setSelectedBankId] = useState<string | null>(null);
  const [selectedLedgerId, setSelectedLedgerId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [excluding, setExcluding] = useState(false);
  const [excludeReason, setExcludeReason] = useState<string>(EXCLUDE_REASONS[0]);
  const [excludeNote, setExcludeNote] = useState("");

  const hasSuggestions = existingMatches.length > 0;
  const hasUnmatched = unmatchedBank.length > 0 || unmatchedLedger.length > 0;

  // Manual matches are a human override, so before allowing one we flag
  // anything that suggests the two rows are not the same event. Both sides
  // use one sign convention: positive = money leaving the account,
  // negative = money coming in.
  const selectedBank = unmatchedBank.find((t) => t.id === selectedBankId);
  const selectedLedger = unmatchedLedger.find((t) => t.id === selectedLedgerId);
  const bankAmount = selectedBank ? Number(selectedBank.amount) : 0;
  const ledgerAmount = selectedLedger ? Number(selectedLedger.amount) : 0;
  const hasBothSelected = !!selectedBank && !!selectedLedger;
  const oppositeSigns = hasBothSelected && Math.sign(bankAmount) !== Math.sign(ledgerAmount);
  // Compare sizes ignoring direction so each problem is reported once.
  const amountGap = hasBothSelected ? Math.abs(Math.abs(bankAmount) - Math.abs(ledgerAmount)) : 0;
  const amountsDiffer = amountGap >= 0.005;
  const hasWarning = oppositeSigns || amountsDiffer;
  const directionOf = (t: TxnRow) => (Number(t.amount) < 0 ? "money coming in" : "money going out");

  const selectedIds = [selectedBankId, selectedLedgerId].filter(Boolean) as string[];

  const run = (work: () => Promise<{ error?: string } | void>) => {
    setActionError(null);
    startTransition(async () => {
      const res = await work();
      if (res && "error" in res && res.error) setActionError(res.error);
    });
  };

  const handleExclude = () => {
    run(async () => {
      for (const id of selectedIds) {
        const res = await excludeTransaction(id, accountId, excludeReason, excludeNote);
        if (res.error) return res;
      }
      setSelectedBankId(null);
      setSelectedLedgerId(null);
      setExcluding(false);
      setExcludeNote("");
    });
  };

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
            {unmatchedBank.length > 0 && unmatchedLedger.length === 0
              ? "There are no ledger transactions this month, so there is nothing for the bank items to pair with."
              : unmatchedLedger.length > 0 && unmatchedBank.length === 0
                ? "There are no bank transactions this month, so there is nothing for the ledger items to pair with."
                : hasSuggestions
                  ? "These have no suggested pairing. Select one from each side to match them manually."
                  : "None of these look like the same transaction. Suggestions need the same amount and direction within 7 days of each other. You can still match two items yourself: select one from each side."}
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
              {hasWarning && selectedBank && selectedLedger && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-status-pending/40 bg-status-pendingBg px-3 py-2 text-sm text-ink-800"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-pending" />
                  <div className="space-y-1.5">
                    {amountsDiffer && (
                      <p>
                        <span className="font-medium">Amounts differ.</span> The bank transaction is{" "}
                        {formatCurrency(Math.abs(bankAmount), selectedBank.currency ?? currency)} but the ledger entry is{" "}
                        {formatCurrency(Math.abs(ledgerAmount), selectedLedger.currency ?? currency)}, a gap of{" "}
                        {formatCurrency(amountGap, selectedBank.currency ?? currency)}. If they really are the same
                        event, that gap needs an explanation (a fee, tax, rounding, or a typo in one entry).
                      </p>
                    )}
                    {oppositeSigns && (
                      <p>
                        <span className="font-medium">Opposite directions.</span> The bank transaction is{" "}
                        {directionOf(selectedBank)}, but the ledger entry is {directionOf(selectedLedger)}. Check the
                        sign of the ledger entry before continuing.
                      </p>
                    )}
                  </div>
                </div>
              )}
              <Button
                size="sm"
                variant={hasWarning ? "destructive" : "primary"}
                onClick={handleManualMatch}
                disabled={!selectedBankId || !selectedLedgerId || isPending}
              >
                <GitMerge className="h-3.5 w-3.5" />
                {hasWarning ? "Match anyway" : "Match selected"}
              </Button>
              {selectedIds.length === 0 && (
                <span className="ml-3 text-xs text-ink-500">Select a transaction to match it or exclude it.</span>
              )}
              {selectedIds.length > 0 && !excluding && (
                <Button size="sm" variant="ghost" className="ml-2" onClick={() => setExcluding(true)} disabled={isPending}>
                  Exclude {selectedIds.length === 1 ? "selected" : `${selectedIds.length} selected`}…
                </Button>
              )}
              {excluding && selectedIds.length > 0 && (
                <div className="rounded-md border border-ink-200 bg-ink-50 p-3 text-sm">
                  <p className="font-medium text-ink-900">
                    Exclude {selectedIds.length === 1 ? "this transaction" : "these transactions"} from the reconciliation?
                  </p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    Excluded items are left out of the totals. You can restore them later from the Excluded list below.
                  </p>
                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <label className="flex flex-col gap-1 text-xs font-medium text-ink-700">
                      Reason
                      <select
                        value={excludeReason}
                        onChange={(e) => setExcludeReason(e.target.value)}
                        className="h-9 min-w-[14rem] rounded border border-ink-200 bg-white py-0 pl-3 pr-8 text-sm font-normal text-ink-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                      >
                        {EXCLUDE_REASONS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-xs font-medium text-ink-700">
                      Note {excludeReason === "Other" ? "(required)" : "(optional)"}
                      <input
                        value={excludeNote}
                        onChange={(e) => setExcludeNote(e.target.value)}
                        maxLength={300}
                        className="h-9 rounded border border-ink-200 bg-white px-3 text-sm font-normal text-ink-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                      />
                    </label>
                    <Button size="sm" onClick={handleExclude} disabled={isPending}>
                      Exclude
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setExcluding(false)} disabled={isPending}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {actionError && (
        <p role="alert" className="rounded-md border border-status-exception/20 bg-status-exceptionBg px-3 py-2 text-sm text-status-exception">
          {actionError}
        </p>
      )}

      {confirmedMatches.length > 0 && (
        <details className="rounded-lg border border-ink-100 bg-white">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink-700">
            Confirmed matches ({confirmedMatches.length})
          </summary>
          <ul className="divide-y divide-ink-100 border-t border-ink-100">
            {confirmedMatches.map((match) => {
              const bank = match.match_lines.find((l) => l.side === "bank")?.transactions;
              const ledger = match.match_lines.find((l) => l.side === "ledger")?.transactions;
              if (!bank || !ledger) return null;
              return (
                <li key={match.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm">
                  <div className="min-w-[12rem] flex-1">
                    <p className="text-xs text-ink-500">Bank</p>
                    <p className="font-medium tabular-nums text-ink-900">{formatCurrency(bank.amount, bank.currency ?? currency)}</p>
                    <p className="text-xs text-ink-500">
                      {formatDate(bank.transaction_date)} · {bank.description ?? "No description"}
                    </p>
                  </div>
                  <div className="min-w-[12rem] flex-1">
                    <p className="text-xs text-ink-500">Ledger</p>
                    <p className="font-medium tabular-nums text-ink-900">{formatCurrency(ledger.amount, ledger.currency ?? currency)}</p>
                    <p className="text-xs text-ink-500">
                      {formatDate(ledger.transaction_date)} · {ledger.description ?? "No description"}
                    </p>
                  </div>
                  <span className="text-xs text-ink-500">{match.match_type === "manual" ? "Matched by hand" : "Suggested match"}</span>
                  {canMatch && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => {
                        if (!window.confirm("Undo this match? Both transactions go back to unmatched.")) return;
                        run(() => unmatchMatch(match.id, accountId));
                      }}
                    >
                      Unmatch
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      )}

      {excludedTxns.length > 0 && (
        <details className="rounded-lg border border-ink-100 bg-white">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink-700">Excluded transactions ({excludedTxns.length})</summary>
          <ul className="divide-y divide-ink-100 border-t border-ink-100">
            {excludedTxns.map((txn) => (
              <li key={txn.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <div>
                  <p className="font-medium tabular-nums text-ink-900">{formatCurrency(txn.amount, txn.currency ?? currency)}</p>
                  <p className="text-xs text-ink-500">
                    {formatDate(txn.transaction_date)} · {txn.description ?? "No description"}
                  </p>
                </div>
                {canMatch && (
                  <Button size="sm" variant="ghost" disabled={isPending} onClick={() => run(() => restoreTransaction(txn.id, accountId))}>
                    Restore
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {!hasSuggestions && !hasUnmatched && confirmedMatches.length === 0 && excludedTxns.length === 0 && (
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