import type { BalanceRec } from "@/lib/balance-rec";
import { formatCurrency } from "@/lib/utils";

/** The balance reconciliation as it prints in a report: both sides, adjusted, and whether they agree. */
export function BalanceRecStatement({ rec, currency }: { rec: BalanceRec; currency: string }) {
  const card = rec.kind === "card";
  const side = (title: string, opening: number, lines: BalanceRec["bankLines"], adjustedLabel: string, adjusted: number) => (
    <table className="w-full text-sm">
      <tbody>
        <tr className="border-b border-ink-100">
          <td className="py-2 pr-2 font-medium text-ink-900">{title}</td>
          <td className="py-2 text-right font-medium tabular-nums text-ink-900">{formatCurrency(opening, currency)}</td>
        </tr>
        {lines
          .filter((l) => l.items.length > 0)
          .map((l) => (
            <tr key={l.label}>
              <td className="py-1.5 pl-3 pr-2 text-ink-700">
                {l.label} <span className="text-xs text-ink-400">({l.items.length})</span>
              </td>
              <td className="py-1.5 text-right tabular-nums text-ink-800">
                {l.effect < 0 ? "−" : "+"} {formatCurrency(Math.abs(l.effect), currency)}
              </td>
            </tr>
          ))}
        <tr className="border-t border-ink-200">
          <td className="py-2 pr-2 font-semibold text-ink-900">{adjustedLabel}</td>
          <td className="py-2 text-right font-semibold tabular-nums text-ink-900">{formatCurrency(adjusted, currency)}</td>
        </tr>
      </tbody>
    </table>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {side(card ? "Amount owed per card statement" : "Balance per bank statement", rec.statementClosing, rec.bankLines, "Adjusted statement balance", rec.adjustedBank)}
        {side(card ? "Amount owed per your books" : "Balance per your books", rec.bookClosing, rec.bookLines, "Adjusted book balance", rec.adjustedBook)}
      </div>
      <p className={rec.reconciled ? "text-sm font-medium text-status-matched" : "text-sm font-medium text-status-exception"}>
        {rec.reconciled ? "Reconciled: both sides agree." : `Out of balance by ${formatCurrency(Math.abs(rec.difference), currency)}.`}
      </p>
    </div>
  );
}
