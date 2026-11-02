/**
 * Builds the body QuickBooks expects when creating a journal entry, with no network or database access
 * so it can be tested. QuickBooks wants every line as a positive amount marked Debit or Credit, the
 * entry balanced, and amounts to two decimal places.
 */

export const LEDGERLINE_MARKER_PREFIX = "[Ledgerline:";

export interface PushLine {
  qbAccountId: string;
  debit: number;
  credit: number;
  memo: string | null;
}

export interface PushInput {
  entryId: string;
  entryDate: string;
  description: string | null;
  lines: PushLine[];
}

const cents = (n: number) => Math.round(n * 100);

export function buildQuickBooksJournalEntry(input: PushInput): { body: Record<string, unknown> } | { error: string } {
  if (input.lines.length < 2) return { error: "A journal entry needs at least two lines." };

  let debits = 0;
  let credits = 0;
  const lines: Record<string, unknown>[] = [];
  for (const l of input.lines) {
    const debit = cents(l.debit);
    const credit = cents(l.credit);
    if ((debit > 0) === (credit > 0)) return { error: "Each line must be either a debit or a credit." };
    debits += debit;
    credits += credit;
    lines.push({
      DetailType: "JournalEntryLineDetail",
      Amount: (debit > 0 ? debit : credit) / 100,
      Description: (l.memo ?? input.description ?? "").slice(0, 4000) || undefined,
      JournalEntryLineDetail: {
        PostingType: debit > 0 ? "Debit" : "Credit",
        AccountRef: { value: l.qbAccountId },
      },
    });
  }
  if (debits !== credits) return { error: "Debits and credits don't match, so QuickBooks would refuse this entry." };

  // The marker lets Ledgerline recognise its own entry when it syncs from QuickBooks, so it isn't brought back as a second copy.
  const note = `${LEDGERLINE_MARKER_PREFIX}${input.entryId}] ${input.description ?? "Journal entry"}`.slice(0, 4000);
  return { body: { TxnDate: input.entryDate, PrivateNote: note, Line: lines } };
}

/** True for a QuickBooks journal entry that Ledgerline itself sent. */
export const isLedgerlineEntry = (privateNote: unknown): boolean => typeof privateNote === "string" && privateNote.includes(LEDGERLINE_MARKER_PREFIX);

/** The readable reason inside a QuickBooks error response. */
export function quickBooksErrorMessage(responseText: string): string {
  try {
    const fault = JSON.parse(responseText)?.Fault?.Error?.[0];
    if (fault) return [fault.Message, fault.Detail].filter(Boolean).join(": ").slice(0, 500);
  } catch {
    // not JSON: fall through
  }
  return responseText.slice(0, 300);
}

/** QuickBooks account type for an account created from Ledgerline. */
export function quickBooksAccountType(accountType: string, reconcilable: boolean): { AccountType: string; AccountSubType?: string } {
  switch (accountType) {
    case "asset":
      return reconcilable ? { AccountType: "Bank", AccountSubType: "Checking" } : { AccountType: "Other Current Asset" };
    case "liability":
      return reconcilable ? { AccountType: "Credit Card", AccountSubType: "CreditCard" } : { AccountType: "Other Current Liability" };
    case "equity":
      return { AccountType: "Equity" };
    case "revenue":
      return { AccountType: "Income" };
    default:
      return { AccountType: "Expense" };
  }
}
