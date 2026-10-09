import Link from "next/link";
import { Building2, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { can } from "@/lib/permissions";
import { timeAgo } from "@/lib/time-ago";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/shared/empty-state";
import { CreateEntityForm } from "@/components/entities/create-entity-form";
import { ConnectBankButton } from "@/components/plaid/connect-bank-button";

function Chip({ tone, children }: { tone: "ok" | "warn" | "muted"; children: React.ReactNode }) {
  const styles = {
    ok: "bg-status-matchedBg text-status-matched",
    warn: "bg-status-pendingBg text-status-pending",
    muted: "bg-ink-100 text-ink-600",
  };
  return <span className={cn("inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium", styles[tone])}>{children}</span>;
}

export default async function EntitiesPage() {
  const membership = await getCurrentMembership();
  // Cast to `any`: some columns/functions are newer than the generated Supabase types.
  const supabase = (await createClient()) as any;

  const { data: entityRows } = await supabase
    .from("entities")
    .select("id, name, currency, archived_at")
    .order("created_at", { ascending: true });
  const entities: { id: string; name: string; currency: string; archived_at: string | null }[] = entityRows ?? [];
  const active = entities.filter((e) => !e.archived_at);
  const archived = entities.filter((e) => e.archived_at);

  const canManage = membership ? can(membership.role, "entities.manage") : false;

  const { data: overviewRows } = await supabase.rpc("entities_overview");
  const overview = new Map<string, any>(((overviewRows ?? []) as any[]).map((o) => [o.entity_id, o]));

  const { data: accountRows } = await supabase
    .from("accounts")
    .select("entity_id, plaid_item_id, quickbooks_account_id, quickbooks_item_id")
    .is("archived_at", null);
  const accounts: { entity_id: string; plaid_item_id: string | null; quickbooks_account_id: string | null; quickbooks_item_id: string | null }[] = accountRows ?? [];

  const itemIds = [...new Set(accounts.map((a) => a.plaid_item_id).filter(Boolean))] as string[];
  const { data: itemRows } = itemIds.length
    ? await supabase.from("plaid_items").select("id, disconnected_at").in("id", itemIds)
    : { data: [] };
  const disconnected = new Set<string>(((itemRows ?? []) as any[]).filter((i) => i.disconnected_at).map((i) => i.id));

  const { data: jobRows } = itemIds.length
    ? await supabase
        .from("sync_jobs")
        .select("plaid_item_id, completed_at")
        .eq("job_type", "plaid_sync")
        .eq("status", "completed")
        .in("plaid_item_id", itemIds)
        .order("completed_at", { ascending: false })
        .limit(500)
    : { data: [] };
  const lastPlaidSync = new Map<string, string>();
  for (const j of (jobRows ?? []) as any[]) if (j.plaid_item_id && !lastPlaidSync.has(j.plaid_item_id)) lastPlaidSync.set(j.plaid_item_id, j.completed_at);

  const { data: qbRows } = membership
    ? await supabase.from("quickbooks_items").select("id, entity_id, last_synced_at").eq("organization_id", membership.organizationId)
    : { data: [] };
  const qbItems: { id: string; entity_id: string | null; last_synced_at: string | null }[] = qbRows ?? [];

  const summaries = new Map(
    entities.map((e) => {
      const own = accounts.filter((a) => a.entity_id === e.id);
      const bankItems = [...new Set(own.map((a) => a.plaid_item_id).filter(Boolean))] as string[];
      const liveBanks = bankItems.filter((i) => !disconnected.has(i));
      // Same lookup order the sync uses: the entity's own connection, else the one its accounts
      // came from, else a shared organization-wide connection.
      const boundIds = new Set(own.map((a) => a.quickbooks_item_id).filter(Boolean) as string[]);
      const qb = qbItems.find((i) => i.entity_id === e.id) ?? qbItems.find((i) => boundIds.has(i.id)) ?? null;
      const hasQuickBooks = !!qb || own.some((a) => a.quickbooks_account_id);
      const syncTimes = [
        ...liveBanks.map((i) => lastPlaidSync.get(i)).filter(Boolean),
        ...(qb?.last_synced_at ? [qb.last_synced_at] : []),
      ] as string[];
      syncTimes.sort();
      return [
        e.id,
        {
          liveBanks: liveBanks.length,
          disconnectedBanks: bankItems.length - liveBanks.length,
          hasQuickBooks,
          lastSync: syncTimes[syncTimes.length - 1] ?? null,
        },
      ] as const;
    })
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Entities</h1>
        <p className="mt-1 text-sm text-ink-500">
          Legal entities within your organization. Each one has its own chart of accounts and books.
        </p>
      </div>

      {canManage && (
        <div className="flex flex-wrap gap-3">
          <CreateEntityForm />
          {active.length > 0 && <ConnectBankButton entities={active.map((e) => ({ id: e.id, name: e.name }))} />}
        </div>
      )}

      {active.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-ink-100 bg-white shadow-subtle">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-100 bg-ink-50 text-left text-xs font-medium text-ink-500">
                <th className="px-5 py-2.5 font-medium">Entity</th>
                <th className="px-3 py-2.5 font-medium">Accounts</th>
                <th className="px-3 py-2.5 font-medium">Connections</th>
                <th className="px-3 py-2.5 font-medium">Needs attention</th>
                <th className="px-3 py-2.5 font-medium">Last synced</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {active.map((e) => {
                const o = overview.get(e.id);
                const s = summaries.get(e.id);
                const attention = Number(o?.open_exceptions ?? 0);
                return (
                  <tr key={e.id} className="hover:bg-ink-50">
                    <td className="px-5 py-3">
                      <Link href={`/entities/${e.id}`} className="flex items-center gap-3">
                        <Building2 className="h-4 w-4 shrink-0 text-ink-400" />
                        <span>
                          <span className="block font-medium text-ink-900">{e.name}</span>
                          <span className="block text-xs text-ink-500">{e.currency}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-ink-700">
                      {Number(o?.account_count ?? 0)}
                      <span className="block text-xs text-ink-500">{Number(o?.reconcilable_count ?? 0)} reconcilable</span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {s && s.liveBanks > 0 && <Chip tone="ok">{s.liveBanks === 1 ? "Bank connected" : `${s.liveBanks} banks`}</Chip>}
                        {s && s.disconnectedBanks > 0 && <Chip tone="warn">{s.disconnectedBanks} disconnected</Chip>}
                        {s?.hasQuickBooks && <Chip tone="ok">QuickBooks</Chip>}
                        {s && s.liveBanks === 0 && s.disconnectedBanks === 0 && !s.hasQuickBooks && <Chip tone="muted">None</Chip>}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {attention > 0 ? (
                        <Link href="/reconciliation/exceptions" className="font-medium text-status-exception hover:underline">
                          {attention} open exception{attention === 1 ? "" : "s"}
                        </Link>
                      ) : (
                        <span className="text-ink-500">All clear</span>
                      )}
                      {Number(o?.unmatched_count ?? 0) > 0 && (
                        <span className="block text-xs text-ink-500">{Number(o.unmatched_count).toLocaleString()} unmatched</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-ink-600">{timeAgo(s?.lastSync)}</td>
                    <td className="px-3 py-3 text-right">
                      <Link href={`/entities/${e.id}`} aria-label={`Open ${e.name}`}>
                        <ChevronRight className="h-4 w-4 text-ink-300" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          icon={<Building2 className="h-8 w-8" />}
          title={archived.length > 0 ? "No active entities" : "No entities yet"}
          description={
            archived.length > 0
              ? "All of your entities are archived. Restore one below to use it again."
              : "Add your first legal entity to start setting up accounts and reconciliation."
          }
        />
      )}

      {archived.length > 0 && (
        <details className="rounded-xl border border-ink-100 bg-white shadow-subtle">
          <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-ink-700">Archived entities ({archived.length})</summary>
          <ul className="divide-y divide-ink-100 border-t border-ink-100">
            {archived.map((e) => (
              <li key={e.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <span className="text-ink-700">
                  {e.name} <span className="text-xs text-ink-400">· {e.currency}</span>
                </span>
                <Link href={`/entities/${e.id}`} className="font-medium text-accent-600 hover:text-accent-700">
                  View or restore →
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
