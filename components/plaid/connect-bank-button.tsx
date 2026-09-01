"use client";

import { useCallback, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { createLinkToken, exchangePublicToken, type PendingAccount } from "@/lib/actions/plaid";
import { Button } from "@/components/ui/button";
import { EntityAssignmentPicker } from "@/components/plaid/entity-assignment-picker";

type Entity = { id: string; name: string };

export function ConnectBankButton({ entities, presetEntityId }: { entities: Entity[]; presetEntityId?: string }) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingAccounts, setPendingAccounts] = useState<PendingAccount[] | null>(null);
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);

  const onSuccess = useCallback(async (publicToken: string) => {
    setLoading(true);
    setError(null);
    const result = await exchangePublicToken(publicToken, presetEntityId);
    setLoading(false);

    if (result?.error) {
      setError(result.error);
      return;
    }
    if (result?.needsEntityAssignment && result.pendingAccounts && result.plaidItemId) {
      setPendingAccounts(result.pendingAccounts);
      setPendingItemId(result.plaidItemId);
    }
  }, []);

  const { open, ready } = usePlaidLink({
    token: linkToken ?? "",
    onSuccess,
  });

  const handleConnectClick = async () => {
    setLoading(true);
    setError(null);
    const result = await createLinkToken();
    setLoading(false);

    if (result.error || !result.linkToken) {
      setError(result.error ?? "Could not start bank connection.");
      return;
    }
    setLinkToken(result.linkToken);
  };

  // Once linkToken is set and Plaid's script reports ready, open the
  // widget immediately rather than requiring a second click.
  if (linkToken && ready && !pendingAccounts) {
    open();
  }

  if (pendingAccounts && pendingItemId) {
    return <EntityAssignmentPicker accounts={pendingAccounts} plaidItemId={pendingItemId} entities={entities} />;
  }

  return (
    <div className="space-y-2">
      <Button onClick={handleConnectClick} loading={loading}>
        Connect bank account
      </Button>
      {error && <p className="text-sm text-status-exception">{error}</p>}
    </div>
  );
}
