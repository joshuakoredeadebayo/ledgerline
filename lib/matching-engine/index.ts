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
 */
export function suggestMatches(
  bankTxns: MatchCandidate[],
  ledgerTxns: MatchCandidate[]
): SuggestedMatch[] {
  const suggestions: SuggestedMatch[] = [];
  const usedLedgerIds = new Set<string>();

  for (const bank of bankTxns) {
    let best: SuggestedMatch | null = null;

    for (const ledger of ledgerTxns) {
      if (usedLedgerIds.has(ledger.id)) continue;

      const confidence = scoreMatch(bank, ledger);
      if (confidence >= 0.5 && (!best || confidence > best.confidence)) {
        best = { bankTransaction: bank, ledgerTransaction: ledger, confidence };
      }
    }

    if (best) {
      suggestions.push(best);
      usedLedgerIds.add(best.ledgerTransaction.id);
    }
  }

  return suggestions;
}

function scoreMatch(bank: MatchCandidate, ledger: MatchCandidate): number {
  const amountDiff = Math.abs(Math.abs(bank.amount) - Math.abs(ledger.amount));
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
