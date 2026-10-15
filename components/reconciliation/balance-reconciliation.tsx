"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveStatementBalances } from "@/lib/actions/balance-rec";
import type { BalanceRec, BalanceRecLine } from "@/lib/balance-rec";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const inputClass =
  "h-9 w-full rounded border border-ink-200 bg-white px-2.5 text-right text-sm tabular-nums text-ink-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500";

function Line({ line, currency }: { line: BalanceRecLine; currency: string }) {
  if (line.items.length === 0) return null;
  const sign = line.effect < 0 ? "−" : "+";
  return (
    <>
      <tr>
        <td className="py-1.5 pl-3 pr-2 text-sm text-ink-700">
          {line.label} <span className="text-xs text-ink-400">({line.items.length})</span>
        </td>
        <td className="py-1.5 text-right text-sm tabular-nums text-ink-800">
          {sign} {formatCurrency(Math.abs(line.effect), currency)}
        </td>
      </tr>
      <tr>
        <td colSpan={2} className="pb-1.5 pl-3">
          <details className="text-xs text-ink-500">
            <summary className="cursor-pointer hover:text-ink-700">Show these items</summary>
            <ul className="mt-1 space-y-0.5">
              {line.items.map((i) => (
                <li key={i.id} className="flex justify-between gap-4">
                  <span>
                    {i.date} · {i.description ?? "No description"}
                  </span>
                  <span className="tabular-nums">{formatCurrency(i.amount, currency)}</span>
                </li>
              ))}
            </ul>
          </details>
        </td>
      </tr>
    </>
  );
}

/**
 * The bank reconciliation statement for a period: the statement's closing balance and the books'
 * closing balance, each adjusted for the items still in flight, which must come to the same figure.
 */
export function BalanceReconciliation({
  accountId,
  month,
  currency,
  kind,
  rec,
  suggestion,
  canEdit,
  finalized,
}: {
  accountId: string;
  month: string;
  currency: string;
  kind: "cash" | "card";
  rec: BalanceRec | null;
  suggestion: { balance: number; asOf: string } | null;
  canEdit: boolean;
  finalized: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(rec === null);
  const [statement, setStatement] = useState(rec ? String(rec.statementClosing) : "");
  const [books, setBooks] = useState(rec ? String(rec.bookClosing) : "");
  const [error, setError] = useState<string | null>(null);

  const bankLabel = kind === "card" ? "Amount owed per card statement" : "Balance per bank statement";
  const bookLabel = kind === "card" ? "Amount owed per your books" : "Balance per your books";

  const save = (clear: boolean) => {
    setError(null);
    const s = clear ? null : Number(statement);
    const b = clear ? null : Number(books);
    if (!clear && (statement.trim() === "" || books.trim() === "" || !Number.isFinite(s) || !Number.isFinite(b))) {
      setError("Enter both balances as numbers.");
      return;
    }
    startTransition(async () => {
      const res = await saveStatementBalances({ accountId, month, statementClosing: s, bookClosing: b });
      if (res.error) setError(res.error);
      else {
        if (clear) {
          setStatement("");
          setBooks("");
          setEditing(true);
        } else setEditing(false);
        router.refresh();
      }
    });
  };

  return (
    <section className="space-y-4 rounded-xl border border-ink-100 bg-white p-5 shadow-subtle">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-ink-900">Balance reconciliation</h2>
          <p className="mt-0.5 text-xs text-ink-500">
            Enter the closing balance from the {kind === "card" ? "card" : "bank"} statement and the same date&apos;s balance in your books. Both, adjusted for the
            items still in flight, should come to the same figure.
          </p>
        </div>
        {rec && !editing && canEdit && !finalized && (
          <button type="button" onClick={() => setEditing(true)} className="text-xs font-medium text-accent-600 hover:text-accent-700">
            Edit balances
          </button>
        )}
      </div>

      {editing && canEdit && !finalized && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
              {bankLabel}
              <input type="number" step="0.01" inputMode="decimal" value={statement} onChange={(e) => setStatement(e.target.value)} className={inputClass} />
              {suggestion && (
                <button
                  type="button"
                  onClick={() => setStatement(String(suggestion.balance))}
                  className="self-start text-xs font-normal text-accent-600 hover:text-accent-700"
                >
                  Use {formatCurrency(suggestion.balance, currency)} from the imported statement (as of {suggestion.asOf})
                </button>
              )}
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
              {bookLabel}
              <input type="number" step="0.01" inputMode="decimal" value={books} onChange={(e) => setBooks(e.target.value)} className={inputClass} />
              <span className="text-xs font-normal text-ink-500">From your accounting system, at the last day of the month.</span>
            </label>
          </div>
          {error && (
            <p role="alert" className="text-sm text-status-exception">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" loading={pending} onClick={() => save(false)}>
              Save balances
            </Button>
            {rec && (
              <>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <button type="button" disabled={pending} onClick={() => save(true)} className="text-xs font-medium text-ink-500 hover:text-status-exception">
                  Clear balances
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {!editing && rec && (
        <>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <table className="w-full">
              <tbody>
                <tr className="border-b border-ink-100">
                  <td className="py-2 pr-2 text-sm font-medium text-ink-900">{bankLabel}</td>
                  <td className="py-2 text-right text-sm font-medium tabular-nums text-ink-900">{formatCurrency(rec.statementClosing, currency)}</td>
                </tr>
                {rec.bankLines.map((l) => (
                  <Line key={l.label} line={l} currency={currency} />
                ))}
                <tr className="border-t border-ink-200">
                  <td className="py-2 pr-2 text-sm font-semibold text-ink-900">Adjusted statement balance</td>
                  <td className="py-2 text-right text-sm font-semibold tabular-nums text-ink-900">{formatCurrency(rec.adjustedBank, currency)}</td>
                </tr>
              </tbody>
            </table>

            <table className="w-full">
              <tbody>
                <tr className="border-b border-ink-100">
                  <td className="py-2 pr-2 text-sm font-medium text-ink-900">{bookLabel}</td>
                  <td className="py-2 text-right text-sm font-medium tabular-nums text-ink-900">{formatCurrency(rec.bookClosing, currency)}</td>
                </tr>
                {rec.bookLines.map((l) => (
                  <Line key={l.label} line={l} currency={currency} />
                ))}
                <tr className="border-t border-ink-200">
                  <td className="py-2 pr-2 text-sm font-semibold text-ink-900">Adjusted book balance</td>
                  <td className="py-2 text-right text-sm font-semibold tabular-nums text-ink-900">{formatCurrency(rec.adjustedBook, currency)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {rec.reconciled ? (
            <p className="rounded-lg border border-status-matched/20 bg-status-matchedBg px-4 py-3 text-sm font-medium text-status-matched">
              Reconciled. Both sides come to {formatCurrency(rec.adjustedBank, currency)}.
            </p>
          ) : (
            <p className="rounded-lg border border-status-exception/20 bg-status-exceptionBg px-4 py-3 text-sm text-status-exception">
              <span className="font-medium">Out by {formatCurrency(Math.abs(rec.difference), currency)}.</span> The two adjusted balances should be equal. This usually
              means a transaction is missing or wrong on one side, or a balance was entered for the wrong date. This period can&apos;t be finalized until it agrees.
            </p>
          )}
        </>
      )}

      {!rec && (!canEdit || finalized) && <p className="text-sm text-ink-500">No balances were entered for this period.</p>}
    </section>
  );
}
