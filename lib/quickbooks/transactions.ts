/**
 * Turns QuickBooks transaction objects into ledger-side rows, one function per transaction
 * type. Pure functions with no network or database access, so the sign rules can be
 * checked on their own.
 *
 * Direction convention (the same one Plaid's bank rows use): positive = money leaving the
 * account, negative = money coming in. QuickBooks amounts are unsigned, so the direction
 * is decided here from the transaction type and which side of it the account sits on.
 */

export interface LedgerRow {
  /** QuickBooks account the row belongs to (matched against imported accounts later). */
  qbAccountId: string;
  amount: number;
  currency: string;
  date: string;
  description: string;
  /** Stable per-row key stored as quickbooks_transaction_id, so re-syncing updates instead of duplicating. */
  key: string;
  raw: unknown;
}

const currencyOf = (txn: any) => txn?.CurrencyRef?.value ?? "USD";
const num = (v: unknown) => Number(v ?? 0);

/**
 * A transfer between two accounts: money leaves the "from" account and arrives in the
 * "to" account. Each side becomes its own row, so each can be matched against its own
 * bank statement.
 */
export function mapTransfer(t: any): LedgerRow[] {
  const amount = num(t.Amount);
  if (!amount) return []; // voided
  const rows: LedgerRow[] = [];
  const note = t.PrivateNote as string | undefined;

  if (t.FromAccountRef?.value) {
    rows.push({
      qbAccountId: t.FromAccountRef.value,
      amount,
      currency: currencyOf(t),
      date: t.TxnDate,
      description: note || `Transfer to ${t.ToAccountRef?.name ?? "another account"}`,
      key: `transfer-${t.Id}-out`,
      raw: t,
    });
  }
  if (t.ToAccountRef?.value) {
    rows.push({
      qbAccountId: t.ToAccountRef.value,
      amount: -amount,
      currency: currencyOf(t),
      date: t.TxnDate,
      description: note || `Transfer from ${t.FromAccountRef?.name ?? "another account"}`,
      key: `transfer-${t.Id}-in`,
      raw: t,
    });
  }
  return rows;
}

/** Paying a vendor bill by cheque (from a bank account) or by credit card: money out. */
export function mapBillPayment(b: any): LedgerRow[] {
  const amount = num(b.TotalAmt);
  if (!amount) return [];
  const accountId = b.PayType === "CreditCard" ? b.CreditCardPayment?.CCAccountRef?.value : b.CheckPayment?.BankAccountRef?.value;
  if (!accountId) return [];
  return [
    {
      qbAccountId: accountId,
      amount,
      currency: currencyOf(b),
      date: b.TxnDate,
      description: b.PrivateNote || b.VendorRef?.name || "QuickBooks Bill Payment",
      key: `billpayment-${b.Id}`,
      raw: b,
    },
  ];
}

/**
 * A customer payment received. Only counts when it was deposited straight to an account;
 * payments parked in Undeposited Funds reach the bank later through a Deposit, which is
 * already synced.
 */
export function mapPayment(p: any): LedgerRow[] {
  const amount = num(p.TotalAmt);
  const accountId = p.DepositToAccountRef?.value;
  if (!amount || !accountId) return [];
  return [
    {
      qbAccountId: accountId,
      amount: -amount,
      currency: currencyOf(p),
      date: p.TxnDate,
      description: p.PrivateNote || p.CustomerRef?.name || "QuickBooks Payment",
      key: `payment-${p.Id}`,
      raw: p,
    },
  ];
}

/**
 * A journal entry can touch many accounts, so it yields one row per line. A credit takes
 * money out of a bank or card account (or adds to a card balance) and a debit puts money
 * in, which is why the same rule works for both asset and liability accounts. Lines on
 * accounts that aren't imported are dropped later, when rows are matched to accounts.
 */
export function mapJournalEntry(j: any): LedgerRow[] {
  const rows: LedgerRow[] = [];
  const lines: any[] = Array.isArray(j.Line) ? j.Line : [];
  lines.forEach((line, index) => {
    const detail = line?.JournalEntryLineDetail;
    const accountId = detail?.AccountRef?.value;
    const amount = num(line?.Amount);
    if (!accountId || !amount) return;
    rows.push({
      qbAccountId: accountId,
      amount: detail.PostingType === "Credit" ? amount : -amount,
      currency: currencyOf(j),
      date: j.TxnDate,
      description: line.Description || j.PrivateNote || (j.DocNumber ? `Journal Entry ${j.DocNumber}` : "QuickBooks Journal Entry"),
      key: `journalentry-${j.Id}-${line.Id ?? index}`,
      raw: j,
    });
  });
  return rows;
}
