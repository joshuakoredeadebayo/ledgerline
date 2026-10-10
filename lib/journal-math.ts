/**
 * Validation and arithmetic for journal entries, free of database calls so the rules can
 * be checked on their own. Amounts are compared in whole cents to avoid floating-point
 * drift (0.1 + 0.2 must equal 0.3 here).
 */

export interface JournalLineInput {
  accountId: string;
  debit: number | string;
  credit: number | string;
  memo?: string | null;
}

export interface CleanJournalLine {
  accountId: string;
  /** Exactly one of debit/credit is non-zero, in 2-decimal currency units. */
  debit: number;
  credit: number;
  memo: string | null;
}

export const toCents = (value: number | string): number => Math.round(Number(value || 0) * 100);
export const fromCents = (cents: number): number => cents / 100;

export interface JournalCheck {
  ok: boolean;
  /** Human-readable reasons the entry can't be saved (empty when ok). */
  problems: string[];
  lines: CleanJournalLine[];
  totalDebitCents: number;
  totalCreditCents: number;
}

/**
 * Cleans the lines (dropping fully blank ones) and checks the entry is sound:
 * two or more lines, one side per line, positive amounts, accounts chosen,
 * and total debits equal to total credits.
 */
export function checkJournalLines(rawLines: JournalLineInput[], requireBalanced = true): JournalCheck {
  const problems: string[] = [];
  const lines: CleanJournalLine[] = [];
  let totalDebitCents = 0;
  let totalCreditCents = 0;

  rawLines.forEach((raw, index) => {
    const debit = toCents(raw.debit);
    const credit = toCents(raw.credit);
    const blank = !raw.accountId && debit === 0 && credit === 0 && !(raw.memo ?? "").trim();
    if (blank) return;

    const label = `Line ${index + 1}`;
    if (!raw.accountId) problems.push(`${label}: choose an account.`);
    if (debit < 0 || credit < 0) problems.push(`${label}: amounts can't be negative.`);
    else if (debit > 0 && credit > 0) problems.push(`${label}: use either a debit or a credit, not both.`);
    else if (debit === 0 && credit === 0) problems.push(`${label}: enter a debit or a credit amount.`);

    totalDebitCents += Math.max(0, debit);
    totalCreditCents += Math.max(0, credit);
    lines.push({
      accountId: raw.accountId,
      debit: fromCents(Math.max(0, debit)),
      credit: fromCents(Math.max(0, credit)),
      memo: (raw.memo ?? "").trim() || null,
    });
  });

  if (lines.length < 2) problems.push("A journal entry needs at least two lines.");
  if (requireBalanced && totalDebitCents !== totalCreditCents) {
    const gap = Math.abs(totalDebitCents - totalCreditCents) / 100;
    problems.push(`Debits and credits must be equal (they differ by ${gap.toFixed(2)}).`);
  }

  return { ok: problems.length === 0, problems, lines, totalDebitCents, totalCreditCents };
}

/**
 * The direction a journal line moves money through a bank or card account, using the same
 * convention as every bank and ledger feed in Ledgerline: positive = money leaving the
 * account, negative = money coming in. A credit is money out; a debit is money in.
 */
export function ledgerAmountForLine(line: { debit: number | string; credit: number | string }): number {
  const credit = Number(line.credit || 0);
  const debit = Number(line.debit || 0);
  return Math.round((credit - debit) * 100) / 100;
}

/** The reversing version of an entry: every debit becomes a credit and vice versa. */
export function reverseLines<T extends { debit: number | string; credit: number | string }>(lines: T[]): T[] {
  return lines.map((l) => ({ ...l, debit: Number(l.credit || 0), credit: Number(l.debit || 0) }));
}
