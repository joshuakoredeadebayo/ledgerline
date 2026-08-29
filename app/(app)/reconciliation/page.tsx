import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { GitMerge, Landmark } from "lucide-react";

export default async function ReconciliationPage() {
  const supabase = await createClient();

  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, name, code, entity_id, entities(name)")
    .eq("is_reconcilable", true)
    .order("name");

  // Single pass over unmatched transactions, counted per account in JS —
  // avoids N+1 queries and avoids fragile nested-relation filter strings
  // that don't type-check reliably against generated Supabase types.
  const { data: unmatchedTxns } = await supabase
    .from("transactions")
    .select("account_id")
    .eq("status", "unmatched");

  const unmatchedByAccount = new Map<string, number>();
  for (const t of unmatchedTxns ?? []) {
    unmatchedByAccount.set(t.account_id, (unmatchedByAccount.get(t.account_id) ?? 0) + 1);
  }

  type PendingMatchRow = {
    match_lines: { transactions: { account_id: string } | null }[] | null;
  };

  const { data: pendingMatches } = await supabase
    .from("matches")
    .select("id, match_lines(transactions(account_id))")
    .eq("status", "pending_review");

  const pendingByAccount = new Map<string, number>();
  for (const m of (pendingMatches ?? []) as unknown as PendingMatchRow[]) {
    const accountIds = new Set(
      (m.match_lines ?? []).map((l) => l.transactions?.account_id).filter((id): id is string => !!id)
    );
    for (const id of accountIds) {
      pendingByAccount.set(id, (pendingByAccount.get(id) ?? 0) + 1);
    }
  }

  const accountsWithCounts = (accounts ?? []).map((account) => ({
    ...account,
    unmatchedCount: unmatchedByAccount.get(account.id) ?? 0,
    pendingMatchCount: pendingByAccount.get(account.id) ?? 0,
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Reconciliation</h1>
        <p className="mt-1 text-sm text-ink-500">Accounts across your entities that need matching.</p>
      </div>

      {accountsWithCounts.length > 0 ? (
        <div className="divide-y divide-ink-100 rounded-lg border border-ink-100 bg-white">
          {accountsWithCounts.map((account) => {
            const needsAttention = account.unmatchedCount > 0 || account.pendingMatchCount > 0;
            return (
              <Link
                key={account.id}
                href={`/reconciliation/${account.id}`}
                className="flex items-center justify-between px-4 py-3.5 hover:bg-ink-50"
              >
                <div className="flex items-center gap-3">
                  <Landmark className="h-4 w-4 text-ink-400" />
                  <div>
                    <p className="text-sm font-medium text-ink-900">{account.name}</p>
                    <p className="text-xs text-ink-500">
                      {(account.entities as unknown as { name: string })?.name}
                      {account.code ? ` · ${account.code}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {account.pendingMatchCount > 0 && (
                    <Badge status="pending" label={`${account.pendingMatchCount} to review`} />
                  )}
                  {account.unmatchedCount > 0 && (
                    <Badge status="exception" label={`${account.unmatchedCount} unmatched`} />
                  )}
                  {!needsAttention && <Badge status="matched" label="All clear" />}
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<GitMerge className="h-8 w-8" />}
          title="No reconcilable accounts yet"
          description="Add an entity and at least one account before reconciliation can begin."
          action={
            <Link href="/entities" className="text-sm font-medium text-accent-600 hover:text-accent-700">
              Set up entities →
            </Link>
          }
        />
      )}
    </div>
  );
}
