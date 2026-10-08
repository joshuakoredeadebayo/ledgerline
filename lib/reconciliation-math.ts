/**
 * The arithmetic behind a reconciliation period, kept free of database calls so it can
 * be checked on its own.
 *
 * Sign convention (both sides): positive = money going out, negative = money coming in.
 * A period is reconciled when the ledger total equals the bank total after setting aside:
 *   - excluded transactions (not part of the reconciliation at all),
 *   - "explained" unmatched transactions — a person resolved or dismissed the exception
 *     with a reason (a bank fee not yet booked, an outstanding item, a timing difference),
 *   - matched transactions whose partner falls in a different period (a cut-off difference:
 *     the bank posts on Aug 31, the books on Sep 2; each month shows it, the pair cancels).
 */

export interface PeriodTransaction {
  id: string;
  amount: number | string;
  side: "bank" | "ledger";
  status: "unmatched" | "matched" | "excluded";
}

export interface PeriodTotals {
  /** Everything counted on the ledger / bank side (excluded transactions removed). */
  bookTotal: number;
  externalTotal: number;
  /** Ledger minus bank, after setting aside explained and cross-period items. */
  difference: number;
  /** Unmatched transactions nobody has explained yet. */
  unresolvedIds: string[];
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function computePeriodTotals(
  txns: PeriodTransaction[],
  explainedIds: ReadonlySet<string>,
  crossPeriodMatchedIds: ReadonlySet<string>
): PeriodTotals {
  let book = 0;
  let external = 0;
  let setAsideBook = 0;
  let setAsideExternal = 0;
  const unresolvedIds: string[] = [];

  for (const t of txns) {
    if (t.status === "excluded") continue;
    const amount = Number(t.amount);
    if (t.side === "ledger") book += amount;
    else external += amount;

    const explained = t.status === "unmatched" && explainedIds.has(t.id);
    const crossPeriod = t.status === "matched" && crossPeriodMatchedIds.has(t.id);
    if (explained || crossPeriod) {
      if (t.side === "ledger") setAsideBook += amount;
      else setAsideExternal += amount;
    } else if (t.status === "unmatched") {
      unresolvedIds.push(t.id);
    }
  }

  return {
    bookTotal: round2(book),
    externalTotal: round2(external),
    difference: round2(book - setAsideBook - (external - setAsideExternal)),
    unresolvedIds,
  };
}
