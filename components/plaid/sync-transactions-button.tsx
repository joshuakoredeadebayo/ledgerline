"use client";
import { useState } from "react";
import { syncEntityPlaidItems } from "@/lib/actions/plaid";
import { Button } from "@/components/ui/button";

export function SyncTransactionsButton({ entityId }: { entityId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<number | null>(null);

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
  };

  return (
    <div className="space-y-1">
      <Button onClick={handleClick} loading={loading} variant="secondary">
        Sync transactions
      </Button>
      {error && <p className="text-sm text-status-exception">{error}</p>}
      {lastSynced !== null && !error && (
        <p className="text-sm text-ink-500">Synced {lastSynced} transaction{lastSynced === 1 ? "" : "s"}.</p>
      )}
    </div>
  );
}
