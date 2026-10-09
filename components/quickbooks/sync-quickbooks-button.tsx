"use client";
import { useState } from "react";
import { syncQuickBooksTransactions } from "@/lib/actions/quickbooks";
import { Button } from "@/components/ui/button";

type Mode = "sync" | "resync" | "all";

interface Result {
  synced: number;
  fetched: number;
  unmatched: number;
  skippedNotReconcilable: number;
  breakdown: { type: string; fetched: number; saved: number }[];
}

export function SyncQuickBooksButton({ entityId }: { entityId: string }) {
  const [loading, setLoading] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const run = async (mode: Mode) => {
    setLoading(mode);
    setError(null);
    const res = await syncQuickBooksTransactions(entityId, { fullResync: mode === "resync", allHistory: mode === "all" });
    setLoading(null);
    if (res.error) {
      setError(res.error);
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

  const linkClass = "text-xs font-medium text-accent-600 hover:text-accent-700 disabled:opacity-50";
  const newTypes = result?.breakdown.filter((b) => ["Transfers", "Bill payments", "Customer payments", "Journal entries"].includes(b.type)) ?? [];
  const newFetched = newTypes.reduce((n, b) => n + b.fetched, 0);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button onClick={() => run("sync")} loading={loading === "sync"} disabled={loading !== null} variant="secondary">
          Sync QuickBooks transactions
        </Button>
        <button
          type="button"
          disabled={loading !== null}
          onClick={() => run("resync")}
          title="Re-pull everything QuickBooks changed in the last 90 days, including transfers, bill payments, customer payments and journal entries"
          className={linkClass}
        >
          {loading === "resync" ? "Re-syncing…" : "Re-sync last 90 days"}
        </button>
        <button
          type="button"
          disabled={loading !== null}
          onClick={() => run("all")}
          title="Re-pull all history, however old (up to 1,000 per transaction type)"
          className={linkClass}
        >
          {loading === "all" ? "Re-syncing…" : "Re-sync all history"}
        </button>
      </div>

      {error && <p className="text-sm text-status-exception">{error}</p>}

      {result && !error && (
        <div className="space-y-2 text-sm text-ink-500">
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
          {result.fetched === 0 && <p>QuickBooks returned nothing new. Try “Re-sync all history”.</p>}
          {result.fetched > 0 && newFetched === 0 && (
            <p>QuickBooks has no transfers, bill payments, customer payments or journal entries in this window. Try “Re-sync all history”, or create one in QuickBooks and sync again.</p>
          )}
          {result.skippedNotReconcilable > 0 && (
            <p>
              {result.skippedNotReconcilable} row{result.skippedNotReconcilable === 1 ? " was" : "s were"} skipped because they belong to an account that isn&apos;t switched on for
              reconciliation (edit the account to include it).
            </p>
          )}
          {result.unmatched > 0 && (
            <p className="text-status-exception">
              {result.unmatched} QuickBooks account{result.unmatched === 1 ? "" : "s"} referenced in this activity
              {result.unmatched === 1 ? " hasn't" : " haven't"} been imported yet — import accounts first, then sync again.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
