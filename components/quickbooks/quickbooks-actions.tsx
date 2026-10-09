"use client";

import { useState } from "react";
import { importQuickBooksAccounts, syncQuickBooksTransactions } from "@/lib/actions/quickbooks";
import { Button } from "@/components/ui/button";

type Busy = "import" | "sync" | "resync" | null;

interface SyncResult {
  synced: number;
  fetched: number;
  unmatched: number;
  skippedNotReconcilable: number;
  breakdown: { type: string; fetched: number; saved: number }[];
}

/**
 * The QuickBooks buttons for an entity (import accounts, sync, re-sync), laid out in one
 * row with the other actions. The outcome of whichever one you press appears underneath,
 * across the full width, instead of squeezing beside the buttons.
 *
 * Renders a fragment so its pieces sit directly in the parent's wrapping row.
 */
export function QuickBooksActions({ entityId, canSync }: { entityId: string; canSync: boolean }) {
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<number | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);

  const runImport = async () => {
    setBusy("import");
    setError(null);
    setResult(null);
    const res = await importQuickBooksAccounts(entityId);
    setBusy(null);
    if (res.error) {
      setError(res.error);
      setImported(null);
      return;
    }
    setImported(res.importedCount ?? 0);
  };

  const runSync = async (fullResync: boolean) => {
    setBusy(fullResync ? "resync" : "sync");
    setError(null);
    setImported(null);
    const res = await syncQuickBooksTransactions(entityId, { fullResync });
    setBusy(null);
    if (res.error) {
      setError(res.error);
      setResult(null);
      return;
    }
    setResult({
      synced: res.syncedCount ?? 0,
      fetched: res.fetchedFromQuickBooks ?? 0,
      unmatched: res.unmatchedAccountIds?.length ?? 0,
      skippedNotReconcilable: res.skippedNotReconcilable ?? 0,
      breakdown: res.breakdown ?? [],
    });
  };

  const newTypes = result?.breakdown.filter((b) => ["Transfers", "Bill payments", "Customer payments", "Journal entries"].includes(b.type)) ?? [];
  const newFetched = newTypes.reduce((n, b) => n + b.fetched, 0);

  return (
    <>
      <Button onClick={runImport} loading={busy === "import"} disabled={busy !== null} variant="secondary">
        Import QuickBooks accounts
      </Button>

      {canSync && (
        <>
          <Button onClick={() => runSync(false)} loading={busy === "sync"} disabled={busy !== null} variant="secondary">
            Sync QuickBooks transactions
          </Button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => runSync(true)}
            title="Re-pull everything QuickBooks changed in the last 90 days, including transfers, bill payments, customer payments and journal entries"
            className="self-center text-xs font-medium text-accent-600 hover:text-accent-700 disabled:opacity-50"
          >
            {busy === "resync" ? "Re-syncing…" : "Re-sync last 90 days"}
          </button>
        </>
      )}

      {(error || imported !== null || result) && (
        <div className="w-full space-y-2 text-sm text-ink-500">
          {error && <p className="text-status-exception">{error}</p>}

          {imported !== null && !error && (
            <p>
              Imported {imported} account{imported === 1 ? "" : "s"} from QuickBooks.
            </p>
          )}

          {result && !error && (
            <>
              <p>
                Saved {result.synced} transaction{result.synced === 1 ? "" : "s"} · QuickBooks returned {result.fetched}.
              </p>
              <table className="text-xs">
                <thead>
                  <tr className="text-left text-ink-400">
                    <th className="pr-6 font-medium">Type</th>
                    <th className="pr-6 text-right font-medium">QuickBooks returned</th>
                    <th className="text-right font-medium">Saved</th>
                  </tr>
                </thead>
                <tbody>
                  {result.breakdown.map((b) => (
                    <tr key={b.type}>
                      <td className="pr-6 text-ink-700">{b.type}</td>
                      <td className="pr-6 text-right tabular-nums">{b.fetched}</td>
                      <td className="text-right tabular-nums">{b.saved}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.fetched === 0 && <p>QuickBooks returned nothing new since the last sync. “Re-sync last 90 days” pulls recent activity again.</p>}
              {result.fetched > 0 && newFetched === 0 && (
                <p>QuickBooks has no transfers, bill payments, customer payments or journal entries in this window.</p>
              )}
              {result.skippedNotReconcilable > 0 && (
                <p>
                  {result.skippedNotReconcilable} row{result.skippedNotReconcilable === 1 ? " was" : "s were"} skipped because they belong to an account that
                  isn&apos;t switched on for reconciliation (edit the account to include it).
                </p>
              )}
              {result.unmatched > 0 && (
                <p className="text-status-exception">
                  {result.unmatched} QuickBooks account{result.unmatched === 1 ? "" : "s"} referenced in this activity
                  {result.unmatched === 1 ? " hasn't" : " haven't"} been imported yet. Import accounts first, then sync again.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
