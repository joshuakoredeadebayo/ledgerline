/**
 * The classic bank reconciliation statement, kept free of database calls so it can be tested.
 *
 *   Balance per bank statement
 *     adjusted for items in the books that haven't reached the bank (cheques not yet cashed,
 *     deposits in transit)                                            = Adjusted bank balance
 *   Balance per books
 *     adjusted for items on the bank that aren't in the books yet (fees, interest)
 *                                                                     = Adjusted book balance
 *
 * Reconciled when the two adjusted balances are equal.
 *
 * Direction convention (the same one every feed in Ledgerline uses): an item's amount is positive
 * when money goes out of the account and negative when it comes in. A cash account's balance goes
 * down when money goes out; a credit-card (liability) balance is the amount owed and goes up when
 * money goes out (a new charge). So an item changes a balance by `-amount` for a cash account and
 * `+amount` for a card.
 */

export type BalanceKind = "cash" | "card";

export interface RecItem {
  id: string;
  side: "bank" | "ledger";
  /** Positive = money out, negative = money in. */
  amount: number;
  date: string;
  description: string | null;
}

export interface BalanceRecInput {
  kind: BalanceKind;
  statementClosing: number;
  bookClosing: number;
  /** Items that count as reconciling at the period end: unmatched, or matched to something dated after it. */
  items: RecItem[];
}

export interface BalanceRecLine {
  label: string;
  /** What this line adds to (positive) or takes from (negative) the balance above it. */
  effect: number;
  items: RecItem[];
}

export interface BalanceRec {
  kind: BalanceKind;
  statementClosing: number;
  bookClosing: number;
  bankLines: BalanceRecLine[];
  bookLines: BalanceRecLine[];
  adjustedBank: number;
  adjustedBook: number;
  /** Adjusted bank minus adjusted book. Zero when reconciled. */
  difference: number;
  reconciled: boolean;
}

const cents = (n: number) => Math.round(n * 100);
const money = (c: number) => c / 100;

/** The sign an item's amount takes when it changes this kind of account's balance. */
export const balanceSign = (kind: BalanceKind): 1 | -1 => (kind === "card" ? 1 : -1);

export function kindForAccountType(accountType: string | null | undefined): BalanceKind {
  return accountType === "liability" ? "card" : "cash";
}

export function computeBalanceRec(input: BalanceRecInput): BalanceRec {
  const s = balanceSign(input.kind);
  const sum = (items: RecItem[]) => items.reduce((n, i) => n + cents(i.amount), 0);

  const ledgerOut = input.items.filter((i) => i.side === "ledger" && i.amount > 0);
  const ledgerIn = input.items.filter((i) => i.side === "ledger" && i.amount < 0);
  const bankOut = input.items.filter((i) => i.side === "bank" && i.amount > 0);
  const bankIn = input.items.filter((i) => i.side === "bank" && i.amount < 0);

  const cash = input.kind === "cash";
  const bankLines: BalanceRecLine[] = [
    {
      label: cash ? "Payments in your books not yet on the statement" : "Charges in your books not yet on the statement",
      effect: money(s * sum(ledgerOut)),
      items: ledgerOut,
    },
    {
      label: cash ? "Receipts in your books not yet on the statement" : "Payments and credits in your books not yet on the statement",
      effect: money(s * sum(ledgerIn)),
      items: ledgerIn,
    },
  ];
  const bookLines: BalanceRecLine[] = [
    {
      label: cash ? "Bank charges and payments not yet in your books" : "Card charges not yet in your books",
      effect: money(s * sum(bankOut)),
      items: bankOut,
    },
    {
      label: cash ? "Bank credits and receipts not yet in your books" : "Card payments and credits not yet in your books",
      effect: money(s * sum(bankIn)),
      items: bankIn,
    },
  ];

  const adjustedBankCents = cents(input.statementClosing) + bankLines.reduce((n, l) => n + cents(l.effect), 0);
  const adjustedBookCents = cents(input.bookClosing) + bookLines.reduce((n, l) => n + cents(l.effect), 0);
  const differenceCents = adjustedBankCents - adjustedBookCents;

  return {
    kind: input.kind,
    statementClosing: input.statementClosing,
    bookClosing: input.bookClosing,
    bankLines,
    bookLines,
    adjustedBank: money(adjustedBankCents),
    adjustedBook: money(adjustedBookCents),
    difference: money(differenceCents),
    reconciled: differenceCents === 0,
  };
}

// ── Suggesting the statement's closing balance from imported running balances ──

export interface BalanceRow {
  /** Order the row appeared in the imported file. */
  row: number;
  date: string;
  amount: number;
  /** The running balance printed after this transaction. */
  balance: number;
}

/**
 * Finds the closing balance from imported rows that carry a running balance. A statement can list
 * oldest first or newest first, so rather than guess, this follows the arithmetic: the balance after
 * a row equals the balance after the previous row, adjusted by this row's amount. The row that no
 * other row follows is the last one, and its balance is the closing balance. Returns null when the
 * rows don't chain cleanly (missing rows, mixed files) so the person enters it themselves.
 */
export function suggestClosingBalance(rows: BalanceRow[], kind: BalanceKind): { balance: number; asOf: string } | null {
  if (rows.length === 0) return null;
  if (rows.length === 1) return { balance: rows[0]!.balance, asOf: rows[0]!.date };

  const s = balanceSign(kind);
  // balance before a row = balance after it, undone by its own amount
  const before = (r: BalanceRow) => cents(r.balance) - s * cents(r.amount);

  // A row "follows" another when its before-balance equals that row's after-balance.
  const afterSet = new Map<number, number>();
  for (const r of rows) afterSet.set(cents(r.balance), (afterSet.get(cents(r.balance)) ?? 0) + 1);

  const followed = new Set<number>();
  const byAfter = new Map<number, BalanceRow[]>();
  for (const r of rows) byAfter.set(cents(r.balance), [...(byAfter.get(cents(r.balance)) ?? []), r]);
  for (const r of rows) {
    const candidates = byAfter.get(before(r)) ?? [];
    for (const c of candidates) if (c !== r) followed.add(c.row);
  }

  // The last row is the one nothing follows. Ascending and descending files both land on it.
  const ends = rows.filter((r) => !followed.has(r.row));
  if (ends.length === 1) return { balance: ends[0]!.balance, asOf: ends[0]!.date };
  return null;
}
