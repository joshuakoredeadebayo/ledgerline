"use client";

import { useState } from "react";
import { assignPlaidAccountsToEntities, type PendingAccount } from "@/lib/actions/plaid";
import { Button } from "@/components/ui/button";

type Entity = { id: string; name: string };

export function EntityAssignmentPicker({
  accounts,
  plaidItemId,
  entities,
  onSuccess,
}: {
  accounts: PendingAccount[];
  plaidItemId: string;
  entities: Entity[];
  onSuccess: () => void;
}) {
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allAssigned = accounts.every((a) => selections[a.plaidAccountId]);

  const handleSubmit = async () => {
    setPending(true);
    setError(null);

    const assignments = accounts
      .filter((a) => selections[a.plaidAccountId])
      .map((a) => ({
        plaidAccountId: a.plaidAccountId,
        entityId: selections[a.plaidAccountId] as string,
        name: a.name,
        accountType: a.accountType,
      }));

    if (assignments.length !== accounts.length) {
      setPending(false);
      setError("Please assign every account to an entity before continuing.");
      return;
    }

    const result = await assignPlaidAccountsToEntities(assignments, plaidItemId);
    setPending(false);

    if (result?.error) {
      setError(result.error);
      return;
    }

    // This was the actual bug: nothing previously told the parent the
    // import had finished, so this component just kept rendering with
    // no visible confirmation — looking like the click did nothing,
    // even though the accounts were created successfully.
    onSuccess();
  };

  return (
    <div className="space-y-4 rounded-lg border border-ink-100 bg-white p-4">
      <div>
        <p className="text-sm font-medium text-ink-900">Assign each account to an entity</p>
        <p className="text-sm text-ink-500">Your bank connection covers multiple accounts. Choose which entity each one belongs to.</p>
      </div>

      <div className="space-y-3">
        {accounts.map((account) => (
          <div key={account.plaidAccountId} className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-ink-900">{account.name}</p>
              {account.mask && <p className="text-xs text-ink-400">••••{account.mask}</p>}
            </div>
            <select
              className="h-9 rounded border border-ink-200 bg-white px-3 text-sm text-ink-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
              value={selections[account.plaidAccountId] ?? ""}
              onChange={(e) =>
                setSelections((prev) => ({ ...prev, [account.plaidAccountId]: e.target.value }))
              }
            >
              <option value="" disabled>
                Select entity
              </option>
              {entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.name}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <Button onClick={handleSubmit} disabled={!allAssigned} loading={pending}>
        Confirm and import
      </Button>
      {!allAssigned && !pending && (
        <p className="text-sm text-ink-500">Select an entity for every account above to continue.</p>
      )}
      {error && <p className="text-sm text-status-exception">{error}</p>}
    </div>
  );
}
