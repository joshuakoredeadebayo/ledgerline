export interface MatchCandidate {
  id: string;
  amount: number;
  transaction_date: string;
  description: string | null;
  source: string;
}

export interface SuggestedMatch {
  bankTransaction: MatchCandidate;
  ledgerTransaction: MatchCandidate;
  confidence: number;
}

/**
 * v1 matching engine: deterministic rules only, no ML.
 * Confidence scoring:
 *   - exact amount + same date         -> 0.98
 *   - exact amount + within 3 days     -> 0.85
 *   - exact amount + within 7 days     -> 0.65
 *   - amount within 1% + within 3 days -> 0.55
 * Anything below 0.5 isn't suggested at all — surfaced as an exception instead.
 *
 * Both sides share one sign convention (positive = money leaving the
 * account, negative = money coming in), so a bank outflow can only match
 * a ledger outflow. Opposite-signed pairs are never suggested, even when
 * the absolute amounts are identical.
 *
 * When several pairs score the same (common with round amounts, e.g. four
 * different $500.00 charges), the pair whose descriptions look most alike
 * wins, so "KFC" is paired with "KFC" rather than with whichever $500.00
 * entry happens to come first. Each transaction is used in at most one pair.
 */
export function suggestMatches(
  bankTxns: MatchCandidate[],
  ledgerTxns: MatchCandidate[]
): SuggestedMatch[] {
  // Score every possible bank/ledger pair, then hand out the best pairs first.
  // Going pair-by-pair (not bank-by-bank) stops a weak candidate from using
  // up a ledger entry that a stronger, better-described pair should get.
  const candidates: (SuggestedMatch & { similarity: number; order: number })[] = [];
  bankTxns.forEach((bank, order) => {
    for (const ledger of ledgerTxns) {
      const confidence = scoreMatch(bank, ledger);
      if (confidence < 0.5) continue;
      candidates.push({
        bankTransaction: bank,
        ledgerTransaction: ledger,
        confidence,
        similarity: descriptionSimilarity(bank.description, ledger.description),
        order,
      });
    }
  });

  candidates.sort((x, y) => y.confidence - x.confidence || y.similarity - x.similarity || x.order - y.order);

  const usedBankIds = new Set<string>();
  const usedLedgerIds = new Set<string>();
  const suggestions: (SuggestedMatch & { order: number })[] = [];
  for (const c of candidates) {
    if (usedBankIds.has(c.bankTransaction.id) || usedLedgerIds.has(c.ledgerTransaction.id)) continue;
    usedBankIds.add(c.bankTransaction.id);
    usedLedgerIds.add(c.ledgerTransaction.id);
    suggestions.push({ bankTransaction: c.bankTransaction, ledgerTransaction: c.ledgerTransaction, confidence: c.confidence, order: c.order });
  }

  return suggestions
    .sort((x, y) => x.order - y.order)
    .map(({ bankTransaction, ledgerTransaction, confidence }) => ({ bankTransaction, ledgerTransaction, confidence }));
}

function scoreMatch(bank: MatchCandidate, ledger: MatchCandidate): number {
  // Opposite directions (an inflow vs an outflow) are never the same event.
  if (Math.sign(bank.amount) !== Math.sign(ledger.amount)) return 0;

  const amountDiff = Math.abs(bank.amount - ledger.amount);
  const amountMatch = amountDiff < 0.01;
  const amountClose = amountDiff / Math.max(Math.abs(bank.amount), 0.01) <= 0.01;

  const dayDiff = Math.abs(
    (new Date(bank.transaction_date).getTime() - new Date(ledger.transaction_date).getTime()) /
      (1000 * 60 * 60 * 24)
  );

  if (amountMatch && dayDiff === 0) return 0.98;
  if (amountMatch && dayDiff <= 3) return 0.85;
  if (amountMatch && dayDiff <= 7) return 0.65;
  if (amountClose && dayDiff <= 3) return 0.55;
  return 0;
}

/** 0..1 overlap between the words of two descriptions; used only to break ties. */
function descriptionSimilarity(a: string | null, b: string | null): number {
  const words = (text: string | null) =>
    new Set(
      (text ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .split(" ")
        .filter((w) => w.length > 1)
    );
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / (wa.size + wb.size - shared);
}