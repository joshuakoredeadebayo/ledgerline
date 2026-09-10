"use client";
import { useState } from "react";
import { importQuickBooksAccounts } from "@/lib/actions/quickbooks";
import { Button } from "@/components/ui/button";

export function ImportQuickBooksAccountsButton({ entityId }: { entityId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<number | null>(null);

  const handleClick = async () => {
    setLoading(true);
    setError(null);
    const result = await importQuickBooksAccounts(entityId);
    setLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setImported(result.importedCount ?? 0);
  };

  return (
    <div className="space-y-1">
      <Button onClick={handleClick} loading={loading} variant="secondary">
        Import QuickBooks accounts
      </Button>
      {error && <p className="text-sm text-status-exception">{error}</p>}
      {imported !== null && !error && (
        <p className="text-sm text-ink-500">Imported {imported} account{imported === 1 ? "" : "s"}.</p>
      )}
    </div>
  );
}
