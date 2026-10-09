"use client";
import { useState } from "react";
import { disconnectQuickBooks } from "@/lib/actions/quickbooks";
import { Button } from "@/components/ui/button";

export function DisconnectQuickBooksButton({ connectionId, company }: { connectionId: string; company?: string | null }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    if (
      !confirm(
        `Disconnect ${company ?? "this QuickBooks company"}? Ledgerline will stop syncing new transactions from it. Accounts and transactions already imported stay.`
      )
    ) {
      return;
    }
    setLoading(true);
    setError(null);
    const result = await disconnectQuickBooks(connectionId);
    setLoading(false);
    if (result.error) setError(result.error);
  };

  return (
    <div className="space-y-1 text-right">
      <Button onClick={handleClick} loading={loading} variant="destructive" size="sm">
        Disconnect
      </Button>
      {error && <p className="text-sm text-status-exception">{error}</p>}
    </div>
  );
}
