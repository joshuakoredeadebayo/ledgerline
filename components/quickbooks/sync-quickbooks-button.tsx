"use client";
import { useState } from "react";
import { syncQuickBooksTransactions } from "@/lib/actions/quickbooks";
import { Button } from "@/components/ui/button";

export function SyncQuickBooksButton({ entityId }: { entityId: string }) {
  const [loading, setLoading] = useState<"sync" | "resync" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<number | null>(null);
  const [fetchedFromQuickBooks, setFetchedFromQuickBooks] = useState<number | null>(null);
  const [unmatchedCount, setUnmatchedCount] = useState(0);

  const run = async (fullResync: boolean) => {
    setLoading(fullResync ? "resync" : "sync");
    setError(null);
    const result = await syncQuickBooksTransactions(entityId, { fullResync });
    setLoading(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    setLastSynced(result.syncedCount ?? 0);
    setFetchedFromQuickBooks(result.fetchedFromQuickBooks ?? 0);
    setUnmatchedCount(result.unmatchedAccountIds?.length ?? 0);
  };

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => run(false)} loading={loading === "sync"} disabled={loading !== null} variant="secondary">
          Sync QuickBooks transactions
        </Button>
        <button
          type="button"
          disabled={loading !== null}
          onClick={() => run(true)}
          title="Re-pull the last 90 days, including transfers, bill payments, customer payments and journal entries"
          className="text-xs font-medium text-accent-600 hover:text-accent-700 disabled:opacity-50"
        >
          {loading === "resync" ? "Re-syncing…" : "Re-sync last 90 days"}
        </button>
      </div>
      {error && <p className="text-sm text-status-exception">{error}</p>}
      {lastSynced !== null && !error && (
        <div className="text-sm text-ink-500">
          <p>Synced {lastSynced} transaction{lastSynced === 1 ? "" : "s"}.</p>
          {fetchedFromQuickBooks === 0 && <p>QuickBooks returned nothing new since the last sync.</p>}
          {unmatchedCount > 0 && (
            <p className="text-status-exception">
              {unmatchedCount} QuickBooks account{unmatchedCount === 1 ? "" : "s"} referenced in this activity
              {unmatchedCount === 1 ? " hasn't" : " haven't"} been imported yet — import accounts first, then sync
              again.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
