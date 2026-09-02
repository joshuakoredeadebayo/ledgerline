"use client";
import { useCallback, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { createLinkToken, exchangePublicToken, type PendingAccount } from "@/lib/actions/plaid";
import { Button } from "@/components/ui/button";
import { EntityAssignmentPicker } from "@/components/plaid/entity-assignment-picker";

type Entity = { id: string; name: string };

// Keys used to survive the full-page redirect that OAuth institutions
// (Citibank, etc.) trigger. React state doesn't persist across that
// redirect, so anything Link needs to resume has to live here instead.
// Read/written from both this component and PlaidOAuthRedirectHandler.
const STORAGE_KEYS = {
  linkToken: "plaid_link_token",
  presetEntityId: "plaid_preset_entity_id",
  entities: "plaid_entities",
  returnPath: "plaid_return_path",
} as const;

export function ConnectBankButton({ entities, presetEntityId }: { entities: Entity[]; presetEntityId?: string }) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingAccounts, setPendingAccounts] = useState<PendingAccount[] | null>(null);
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);

  const clearPersistedSession = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEYS.linkToken);
    sessionStorage.removeItem(STORAGE_KEYS.presetEntityId);
    sessionStorage.removeItem(STORAGE_KEYS.entities);
    sessionStorage.removeItem(STORAGE_KEYS.returnPath);
  }, []);

  const onSuccess = useCallback(async (publicToken: string | null) => {
    clearPersistedSession();
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
  }, [presetEntityId, clearPersistedSession]);

  const onExit = useCallback(() => {
    // Person closed Link (or it errored) without completing — clear
    // the persisted session so a later "Connect bank" click starts
    // fresh instead of trying to resume a dead link_token.
    clearPersistedSession();
  }, [clearPersistedSession]);

  const { open, ready } = usePlaidLink({
    token: linkToken ?? "",
    onSuccess,
    onExit,
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
    // Persist everything needed to resume this flow if Plaid redirects
    // the whole page away for an OAuth bank login and back.
    sessionStorage.setItem(STORAGE_KEYS.linkToken, result.linkToken);
    sessionStorage.setItem(STORAGE_KEYS.presetEntityId, presetEntityId ?? "");
    sessionStorage.setItem(STORAGE_KEYS.entities, JSON.stringify(entities));
    sessionStorage.setItem(STORAGE_KEYS.returnPath, window.location.pathname);
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
