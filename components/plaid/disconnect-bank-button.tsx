"use client";

import { useState, useTransition } from "react";
import { disconnectBank } from "@/lib/actions/entity-management";
import { Button } from "@/components/ui/button";

export function DisconnectBankButton({ plaidItemId, institution }: { plaidItemId: string; institution: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          const ok = window.confirm(
            `Disconnect ${institution}?\n\nLedgerline stops syncing it and Plaid revokes access. Its accounts and all existing transactions stay in Ledgerline. You can connect the bank again later.`
          );
          if (!ok) return;
          setError(null);
          startTransition(async () => {
            const res = await disconnectBank(plaidItemId);
            if (res.error) setError(res.error);
          });
        }}
      >
        Disconnect
      </Button>
      {error && <span className="max-w-[16rem] text-right text-xs text-status-exception">{error}</span>}
    </span>
  );
}
