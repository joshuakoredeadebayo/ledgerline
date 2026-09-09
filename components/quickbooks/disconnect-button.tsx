"use client";
import { useState } from "react";
import { disconnectQuickBooks } from "@/lib/actions/quickbooks";
import { Button } from "@/components/ui/button";

export function DisconnectQuickBooksButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    if (!confirm("Disconnect QuickBooks? Ledgerline will stop syncing new transactions from this company.")) {
      return;
    }
    setLoading(true);
    setError(null);
    const result = await disconnectQuickBooks();
    setLoading(false);
    if (result.error) setError(result.error);
  };

  return (
    <div className="space-y-1 text-right">
      <Button onClick={handleClick} loading={loading} variant="destructive">
        Disconnect
      </Button>
      {error && <p className="text-sm text-status-exception">{error}</p>}
    </div>
  );
}
