"use client";
import { useState } from "react";
import { syncEntityPlaidItems } from "@/lib/actions/plaid";
import { Button } from "@/components/ui/button";

export function SyncTransactionsButton({ entityId }: { entityId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<number | null>(null);
  const [fetchedFromPlaid, setFetchedFromPlaid] = useState<number | null>(null);
  const [unmatchedCount, setUnmatchedCount] = useState(0);

  const handleClick = async () => {
    setLoading(true);
    setError(null);
    const result = await syncEntityPlaidItems(entityId);
    setLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setLastSynced(result.syncedCount ?? 0);
    setFetchedFromPlaid(result.fetchedFromPlaid ?? 0);
    setUnmatchedCount(result.unmatchedAccountIds?.length ?? 0);
  };

  return (
    <div className="space-y-1">
      <Button onClick={handleClick} loading={loading} variant="secondary">
        Sync transactions
      </Button>
      {error && <p className="text-sm text-status-exception">{error}</p>}
      {lastSynced !== null && !error && (
        <div className="text-sm text-ink-500">
          <p>Synced {lastSynced} transaction{lastSynced === 1 ? "" : "s"}.</p>
          {fetchedFromPlaid === 0 && (
            <p>Plaid returned 0 transactions for this connection — nothing to import yet.</p>
          )}
          {unmatchedCount > 0 && (
            <p className="text-status-exception">
              Plaid returned {fetchedFromPlaid} transaction{fetchedFromPlaid === 1 ? "" : "s"}, but {unmatchedCount}{" "}
              distinct account{unmatchedCount === 1 ? "" : "s"} didn't match any account in Ledgerline — check that
              accounts were imported for this connection.
            </p>
          )}
        </div>
      )}
    </div>
  );
}