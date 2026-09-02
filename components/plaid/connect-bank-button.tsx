"use client";
import { useCallback, useEffect, useState } from "react";
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

  const onSuccess = useCallback(async (publicToken: string | null) => {
    // Clear the token immediately so the effect below won't reopen
    // Link on the next render — this was the actual bug: without this,
    // the modal kept reopening itself after every successful connection.
    setLinkToken(null);

    if (!publicToken) {
      setError("Bank connection did not complete. Please try again.");
      return;
    }
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
  }, [presetEntityId]);

  const onExit = useCallback(() => {
    // Person closed Link or it errored without completing — clear the
    // token here too, for the same reason as onSuccess above.
    setLinkToken(null);
  }, []);

  const { open, ready } = usePlaidLink({
    token: linkToken ?? "",
    onSuccess,
    onExit,
  });

  // Opens Link exactly once per linkToken, the moment Plaid's script
  // reports ready — not on every render. linkToken is reset to null in
  // onSuccess/onExit specifically so this effect doesn't refire and
  // reopen the modal after the flow has already finished.
  useEffect(() => {
    if (linkToken && ready) {
      open();
    }
  }, [linkToken, ready, open]);

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
