import Link from "next/link";
import { getCurrentMembership } from "@/lib/actions/membership";
import { can } from "@/lib/permissions";
import { getQuickBooksConnection } from "@/lib/actions/quickbooks";
import { createClient } from "@/lib/supabase/server";
import { timeAgo } from "@/lib/time-ago";
import { DisconnectQuickBooksButton } from "@/components/quickbooks/disconnect-button";
import { DisconnectBankButton } from "@/components/plaid/disconnect-bank-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const card = "rounded-xl border border-ink-100 bg-white p-5 shadow-subtle";

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const { connected, error } = await searchParams;
  const membership = await getCurrentMembership();
  const canManage = membership ? can(membership.role, "org.manage_integrations") : false;
  const canDisconnectBanks = membership ? can(membership.role, "entities.manage") : false;
  const connection = await getQuickBooksConnection();

  // Cast to `any`: some columns are newer than the generated Supabase types.
  const supabase = (await createClient()) as any;

  const { data: qbRow } = connection
    ? await supabase.from("quickbooks_items").select("last_synced_at").eq("id", connection.id).maybeSingle()
    : { data: null };

  const { data: itemRows } = await supabase
    .from("plaid_items")
    .select("id, institution_name, disconnected_at, created_at")
    .order("created_at", { ascending: true });
  const banks: { id: string; institution_name: string | null; disconnected_at: string | null; created_at: string }[] = itemRows ?? [];

  const { data: accountRows } = banks.length
    ? await supabase.from("accounts").select("plaid_item_id, entity_id, entities(name)").in("plaid_item_id", banks.map((b) => b.id))
    : { data: [] };
  const accountsByBank = new Map<string, { count: number; entities: Set<string> }>();
  for (const a of (accountRows ?? []) as any[]) {
    const entry = accountsByBank.get(a.plaid_item_id) ?? { count: 0, entities: new Set<string>() };
    entry.count += 1;
    if (a.entities?.name) entry.entities.add(a.entities.name);
    accountsByBank.set(a.plaid_item_id, entry);
  }

  const { data: jobRows } = banks.length
    ? await supabase
        .from("sync_jobs")
        .select("plaid_item_id, completed_at")
        .eq("job_type", "plaid_sync")
        .eq("status", "completed")
        .in("plaid_item_id", banks.map((b) => b.id))
        .order("completed_at", { ascending: false })
        .limit(200)
    : { data: [] };
  const lastSync = new Map<string, string>();
  for (const j of (jobRows ?? []) as any[]) if (j.plaid_item_id && !lastSync.has(j.plaid_item_id)) lastSync.set(j.plaid_item_id, j.completed_at);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Integrations</h1>
        <p className="mt-1 text-sm text-ink-500">The accounting systems and banks Ledgerline pulls transactions from.</p>
      </div>

      {connected && (
        <div className="rounded-lg border border-status-matched/20 bg-status-matchedBg p-3 text-sm text-status-matched">
          QuickBooks connected successfully.
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-status-exception/20 bg-status-exceptionBg p-3 text-sm text-status-exception">
          Could not connect QuickBooks: {decodeURIComponent(error)}
        </div>
      )}

      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-ink-900">QuickBooks Online</h2>
            {connection ? (
              <p className="mt-1 text-sm text-ink-500">
                Connected to <span className="font-medium text-ink-800">{connection.companyName}</span>
                {qbRow?.last_synced_at ? ` · last synced ${timeAgo(qbRow.last_synced_at)}` : " · not synced yet"}
              </p>
            ) : (
              <p className="mt-1 text-sm text-ink-500">Not connected. Connect it to import your chart of accounts and ledger transactions.</p>
            )}
            {connection && (
              <p className="mt-1 text-xs text-ink-500">
                Import accounts and sync transactions from each{" "}
                <Link href="/entities" className="font-medium text-accent-600 hover:text-accent-700">
                  entity&apos;s page
                </Link>
                . One QuickBooks company is shared by the whole organization.
              </p>
            )}
          </div>
          {canManage &&
            (connection ? (
              <DisconnectQuickBooksButton />
            ) : (
              <Button asChild>
                <a href="/api/quickbooks/connect">Connect QuickBooks</a>
              </Button>
            ))}
        </div>
      </section>

      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-ink-900">Bank connections</h2>
            <p className="mt-1 text-sm text-ink-500">Connected through Plaid. Add a bank from the entity it belongs to.</p>
          </div>
          <Link href="/entities" className="text-sm font-medium text-accent-600 hover:text-accent-700">
            Go to entities
          </Link>
        </div>

        {banks.length > 0 ? (
          <ul className="mt-3 divide-y divide-ink-100">
            {banks.map((b) => {
              const info = accountsByBank.get(b.id);
              const off = !!b.disconnected_at;
              return (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <div>
                    <p className="font-medium text-ink-900">{b.institution_name ?? "Bank"}</p>
                    <p className="text-xs text-ink-500">
                      {info?.count ?? 0} account{(info?.count ?? 0) === 1 ? "" : "s"}
                      {info && info.entities.size > 0 ? ` · ${[...info.entities].join(", ")}` : ""}
                      {" · "}
                      {off ? `Disconnected ${timeAgo(b.disconnected_at)}` : `Last synced ${timeAgo(lastSync.get(b.id))}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge status={off ? "neutral" : "matched"} label={off ? "Disconnected" : "Connected"} />
                    {canDisconnectBanks && !off && <DisconnectBankButton plaidItemId={b.id} institution={b.institution_name ?? "this bank"} />}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-ink-500">No banks connected yet.</p>
        )}
      </section>
    </div>
  );
}
