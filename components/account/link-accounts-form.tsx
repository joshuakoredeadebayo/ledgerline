"use client";
import { useState } from "react";
import { linkAccounts, type LinkableAccount } from "@/lib/actions/account-linking";
import { Button } from "@/components/ui/button";

export function LinkAccountsForm({ entityId, accounts }: { entityId: string; accounts: LinkableAccount[] }) {
  const [primaryId, setPrimaryId] = useState("");
  const [secondaryId, setSecondaryId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (accounts.length < 2) return null;

  const handleSubmit = async () => {
    if (!primaryId || !secondaryId) {
      setError("Choose two accounts to link.");
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(false);
    const result = await linkAccounts(entityId, primaryId, secondaryId);
    setLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setSuccess(true);
    setPrimaryId("");
    setSecondaryId("");
  };

  return (
    <div className="rounded-md border border-ink-100 bg-white p-4 space-y-3">
      <div>
        <p className="font-medium text-ink-900">Link accounts</p>
        <p className="text-sm text-ink-500">
          Pick a bank account and its matching book account — this lets Ledgerline compare their transactions against
          each other instead of treating them as unrelated.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={primaryId}
          onChange={(e) => setPrimaryId(e.target.value)}
          className="rounded border border-ink-200 px-3 py-2 text-sm"
        >
          <option value="">Keep this account…</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id} disabled={a.id === secondaryId}>
              {a.name} ({a.code}) · {a.source}
            </option>
          ))}
        </select>
        <span className="text-sm text-ink-400">merge with</span>
        <select
          value={secondaryId}
          onChange={(e) => setSecondaryId(e.target.value)}
          className="rounded border border-ink-200 px-3 py-2 text-sm"
        >
          <option value="">…this account</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id} disabled={a.id === primaryId}>
              {a.name} ({a.code}) · {a.source}
            </option>
          ))}
        </select>
        <Button onClick={handleSubmit} loading={loading} variant="secondary">
          Link accounts
        </Button>
      </div>
      {error && <p className="text-sm text-status-exception">{error}</p>}
      {success && <p className="text-sm text-ink-500">Accounts linked — matching will now consider both sides.</p>}
    </div>
  );
}