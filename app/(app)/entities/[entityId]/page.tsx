import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Landmark } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { can } from "@/lib/permissions";
import { formatMonthDay, timeAgo } from "@/lib/time-ago";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { CreateAccountForm } from "@/components/entities/create-account-form";
import { EditEntityDialog } from "@/components/entities/edit-entity-dialog";
import { ArchiveEntityButton } from "@/components/entities/archive-entity-button";
import { AccountActions, type AccountForActions } from "@/components/entities/account-actions";
import { ConnectBankButton } from "@/components/plaid/connect-bank-button";
import { DisconnectBankButton } from "@/components/plaid/disconnect-bank-button";
import { SyncTransactionsButton } from "@/components/plaid/sync-transactions-button";
import { QuickBooksActions } from "@/components/quickbooks/quickbooks-actions";
import { LinkAccountsForm } from "@/components/accounts/link-accounts-form";
import { getLinkableAccounts } from "@/lib/actions/account-linking";

interface AccountRow {
  id: string;
  name: string;
  code: string | null;
  account_type: string;
  is_reconcilable: boolean;
  source: string | null;
  plaid_account_id: string | null;
  plaid_item_id: string | null;
  quickbooks_account_id: string | null;
  quickbooks_item_id: string | null;
  archived_at: string | null;
}

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—";

export default async function EntityDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ entityId: string }>;
  searchParams: Promise<{ qb?: string }>;
}) {
  const { entityId } = await params;
  const { qb: qbFlag } = await searchParams;
  const membership = await getCurrentMembership();
  // Cast to `any`: some columns/functions are newer than the generated Supabase types.
  const supabase = (await createClient()) as any;

  const { data: entity } = await supabase
    .from("entities")
    .select("id, name, currency, fiscal_year_end, archived_at")
    .eq("id", entityId)
    .single();
  if (!entity) notFound();

  const { data: accountData } = await supabase
    .from("accounts")
    .select("id, name, code, account_type, is_reconcilable, source, plaid_account_id, plaid_item_id, quickbooks_account_id, quickbooks_item_id, archived_at")
    .eq("entity_id", entityId)
    .order("account_type")
    .order("code");
  const allAccounts: AccountRow[] = accountData ?? [];
  const accounts = allAccounts.filter((a) => !a.archived_at);
  const archivedAccounts = allAccounts.filter((a) => a.archived_at);

  const { data: statRows } = await supabase.rpc("entity_account_stats", { p_entity: entityId });
  const stats = new Map<string, { txn_count: number; unmatched_count: number; last_txn_date: string | null }>(
    ((statRows ?? []) as any[]).map((s) => [s.account_id, { txn_count: Number(s.txn_count), unmatched_count: Number(s.unmatched_count), last_txn_date: s.last_txn_date }])
  );

  // Bank connections used by this entity's accounts, with their last successful sync.
  const itemIds = [...new Set(allAccounts.map((a) => a.plaid_item_id).filter(Boolean))] as string[];
  const { data: itemRows } = itemIds.length
    ? await supabase.from("plaid_items").select("id, institution_name, disconnected_at").in("id", itemIds)
    : { data: [] };
  const banks: { id: string; institution_name: string | null; disconnected_at: string | null }[] = itemRows ?? [];
  const { data: jobRows } = itemIds.length
    ? await supabase
        .from("sync_jobs")
        .select("plaid_item_id, completed_at")
        .eq("job_type", "plaid_sync")
        .eq("status", "completed")
        .in("plaid_item_id", itemIds)
        .order("completed_at", { ascending: false })
        .limit(200)
    : { data: [] };
  const lastSync = new Map<string, string>();
  for (const j of (jobRows ?? []) as any[]) if (j.plaid_item_id && !lastSync.has(j.plaid_item_id)) lastSync.set(j.plaid_item_id, j.completed_at);

  const hasQuickBooksAccounts = allAccounts.some((a) => a.quickbooks_account_id);

  // This entity's QuickBooks connection: one made for it, else the one its accounts came
  // from, else a shared organization-wide one (the same order the sync itself uses).
  const { data: qbRows } = membership
    ? await supabase
        .from("quickbooks_items")
        .select("id, entity_id, company_name, last_synced_at")
        .eq("organization_id", membership.organizationId)
        .order("created_at", { ascending: true })
    : { data: [] };
  const qbItems: { id: string; entity_id: string | null; company_name: string | null; last_synced_at: string | null }[] = qbRows ?? [];
  const boundItemIds = new Set(allAccounts.map((a) => a.quickbooks_item_id).filter(Boolean) as string[]);
  const qb =
    qbItems.find((i) => i.entity_id === entityId) ?? qbItems.find((i) => boundItemIds.has(i.id)) ?? qbItems.find((i) => i.entity_id === null) ?? null;

  const isArchived = !!entity.archived_at;
  const canManage = membership ? can(membership.role, "entities.manage") && !isArchived : false;
  const canEntityAdmin = membership ? can(membership.role, "entities.manage") : false;
  const canConnectQuickBooks = membership ? can(membership.role, "org.manage_integrations") && !isArchived : false;
  const canUnlink = membership ? membership.role === "owner" || membership.role === "controller" : false;
  const hasLivePlaid = accounts.some((a) => a.source === "plaid" && a.plaid_item_id && !banks.find((b) => b.id === a.plaid_item_id)?.disconnected_at);
  const linkableAccounts = canManage ? await getLinkableAccounts(entityId) : [];
  const fiscalYearEnd = formatMonthDay(entity.fiscal_year_end);

  const toActions = (a: AccountRow): AccountForActions => ({
    id: a.id,
    name: a.name,
    code: a.code,
    accountType: a.account_type,
    isReconcilable: a.is_reconcilable,
    archived: !!a.archived_at,
    linked: !!a.plaid_account_id && !!a.quickbooks_account_id,
  });

  const sourceLabel = (a: AccountRow) =>
    a.plaid_account_id && a.quickbooks_account_id ? "Plaid + QuickBooks" : a.source === "plaid" ? "Bank (Plaid)" : a.source === "quickbooks" ? "QuickBooks" : "Manual";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link href="/entities" className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-800">
          <ChevronLeft className="h-3.5 w-3.5" />
          Entities
        </Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-3 text-2xl font-semibold text-ink-900">
              {entity.name}
              {isArchived && <Badge status="neutral" label="Archived" />}
            </h1>
            <p className="mt-1 text-sm text-ink-500">
              {entity.currency}
              {fiscalYearEnd ? ` · Fiscal year ends ${fiscalYearEnd}` : ""}
            </p>
          </div>
          {canEntityAdmin && (
            <div className="flex flex-wrap items-center gap-2">
              {!isArchived && (
                <EditEntityDialog
                  entityId={entity.id}
                  name={entity.name}
                  currency={entity.currency}
                  fiscalYearEnd={entity.fiscal_year_end}
                />
              )}
              <ArchiveEntityButton entityId={entity.id} name={entity.name} archived={isArchived} />
            </div>
          )}
        </div>
      </div>

      {qbFlag === "connected" && (
        <p className="rounded-lg border border-status-matched/20 bg-status-matchedBg px-4 py-3 text-sm text-status-matched">
          QuickBooks connected. Next, use “Import QuickBooks accounts”, then sync transactions.
        </p>
      )}

      {isArchived && (
        <p className="rounded-lg border border-status-pending/20 bg-status-pendingBg px-4 py-3 text-sm text-ink-800">
          This entity is archived. It is hidden from reconciliation, the close and bank syncing, and nothing here can be changed until you
          restore it. All of its data is kept.
        </p>
      )}

      {/* Connections */}
      <section className="rounded-xl border border-ink-100 bg-white p-5 shadow-subtle">
        <h2 className="text-[15px] font-semibold text-ink-900">Connections</h2>
          <ul className="mt-2 divide-y divide-ink-100">
            {banks.map((b) => {
              const count = allAccounts.filter((a) => a.plaid_item_id === b.id).length;
              const off = !!b.disconnected_at;
              return (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <div>
                    <p className="font-medium text-ink-900">{b.institution_name ?? "Bank"}</p>
                    <p className="text-xs text-ink-500">
                      {count} account{count === 1 ? "" : "s"} · {off ? `Disconnected ${timeAgo(b.disconnected_at)}` : `Last synced ${timeAgo(lastSync.get(b.id))}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge status={off ? "neutral" : "matched"} label={off ? "Disconnected" : "Connected"} />
                    {canManage && !off && <DisconnectBankButton plaidItemId={b.id} institution={b.institution_name ?? "this bank"} />}
                  </div>
                </li>
              );
            })}
            <li className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <div>
                <p className="font-medium text-ink-900">QuickBooks{qb?.company_name ? ` · ${qb.company_name}` : ""}</p>
                <p className="text-xs text-ink-500">
                  {qb
                    ? `${qb.entity_id ? "Connected to this entity" : "Shared by all entities"} · ${qb.last_synced_at ? `Last synced ${timeAgo(qb.last_synced_at)}` : "Not synced yet"}`
                    : "Not connected to a QuickBooks company"}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Badge status={qb ? "matched" : "neutral"} label={qb ? "Connected" : "Not connected"} />
                {qb ? (
                  <Link href="/settings/integrations" className="text-xs font-medium text-accent-600 hover:text-accent-700">
                    Manage
                  </Link>
                ) : (
                  canConnectQuickBooks && (
                    <a
                      href={`/api/quickbooks/connect?entityId=${entity.id}`}
                      className="inline-flex h-8 items-center rounded border border-ink-200 bg-white px-3 text-sm font-medium text-ink-800 hover:bg-ink-50"
                    >
                      Connect QuickBooks
                    </a>
                  )
                )}
              </div>
            </li>
          </ul>
      </section>

      {canManage && (
        <div className="space-y-4">
          {/* Bank and QuickBooks actions share one row; their results open underneath it. */}
          <div className="flex flex-wrap items-start gap-3">
            <ConnectBankButton entities={[{ id: entity.id, name: entity.name }]} presetEntityId={entity.id} />
            {hasLivePlaid && <SyncTransactionsButton entityId={entity.id} />}
            {qb && <QuickBooksActions entityId={entity.id} canSync={hasQuickBooksAccounts} />}
          </div>
          <div className="max-w-xl">
            <CreateAccountForm entityId={entity.id} />
          </div>
        </div>
      )}
      {canManage && <LinkAccountsForm entityId={entity.id} accounts={linkableAccounts} />}

      {/* Accounts */}
      {accounts.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-ink-100 bg-white shadow-subtle">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-100 bg-ink-50 text-left text-xs font-medium text-ink-500">
                <th className="px-5 py-2.5 font-medium">Account</th>
                <th className="px-3 py-2.5 font-medium">Source</th>
                <th className="px-3 py-2.5 text-right font-medium">Transactions</th>
                <th className="px-3 py-2.5 font-medium">Last activity</th>
                <th className="px-3 py-2.5 font-medium">Reconciliation</th>
                {canManage && <th className="px-5 py-2.5" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {accounts.map((a) => {
                const st = stats.get(a.id);
                return (
                  <tr key={a.id} className="align-middle hover:bg-ink-50">
                    <td className="px-5 py-3">
                      <p className="font-medium text-ink-900">{a.name}</p>
                      <p className="text-xs capitalize text-ink-500">
                        {a.code ?? "—"} · {a.account_type}
                      </p>
                    </td>
                    <td className="px-3 py-3 text-ink-600">{sourceLabel(a)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-ink-900">
                      {(st?.txn_count ?? 0).toLocaleString()}
                      {(st?.unmatched_count ?? 0) > 0 && (
                        <span className="block text-xs text-status-pending">{st!.unmatched_count.toLocaleString()} unmatched</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-ink-600">{fmtDate(st?.last_txn_date)}</td>
                    <td className="px-3 py-3">
                      <Badge status={a.is_reconcilable ? "info" : "neutral"} label={a.is_reconcilable ? "Enabled" : "Off"} />
                    </td>
                    {canManage && (
                      <td className="px-5 py-3 text-right">
                        <AccountActions account={toActions(a)} canUnlink={canUnlink} />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          icon={<Landmark className="h-8 w-8" />}
          title={archivedAccounts.length > 0 && !isArchived ? "No active accounts" : "No accounts yet"}
          description="Add accounts to this entity's chart of accounts to start reconciling transactions."
        />
      )}

      {archivedAccounts.length > 0 && !isArchived && (
        <details className="rounded-xl border border-ink-100 bg-white shadow-subtle">
          <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-ink-700">Archived accounts ({archivedAccounts.length})</summary>
          <ul className="divide-y divide-ink-100 border-t border-ink-100">
            {archivedAccounts.map((a) => (
              <li key={a.id} className={cn("flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm")}>
                <span className="text-ink-700">
                  {a.name} <span className="text-xs text-ink-400">· {a.code ?? "—"} · {a.account_type}</span>
                </span>
                {canManage && <AccountActions account={toActions(a)} canUnlink={false} />}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
