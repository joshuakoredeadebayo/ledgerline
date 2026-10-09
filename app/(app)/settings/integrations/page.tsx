import Link from "next/link";
import { getCurrentMembership } from "@/lib/actions/membership";
import { can } from "@/lib/permissions";
import { listQuickBooksConnections } from "@/lib/actions/quickbooks";
import { createClient } from "@/lib/supabase/server";
import { timeAgo } from "@/lib/time-ago";
import { DisconnectQuickBooksButton } from "@/components/quickbooks/disconnect-button";
import { DisconnectBankButton } from "@/components/plaid/disconnect-bank-button";
import { ConnectQuickBooksForm } from "@/components/quickbooks/connect-quickbooks-form";
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
  const connections = await listQuickBooksConnections();

  // Cast to `any`: some columns are newer than the generated Supabase types.
  const supabase = (await createClient()) as any;

  const { data: entityRows } = await supabase.from("entities").select("id, name").is("archived_at", null).order("name");
  const entityNames = new Map<string, string>(((entityRows ?? []) as any[]).map((e) => [e.id, e.name]));
  const connectedEntityIds = new Set(connections.map((c) => c.entityId).filter(Boolean) as string[]);
  // Entities that don't have their own QuickBooks company yet. The very first connection may
  // instead be shared by everyone, which is how a single-company setup works.
  const connectOptions = [
    ...((entityRows ?? []) as any[]).filter((e) => !connectedEntityIds.has(e.id)).map((e) => ({ value: e.id as string, label: e.name as string })),
    ...(connections.length === 0 ? [{ value: "__shared__", label: "All entities (one shared company)" }] : []),
  ];

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
        <h2 className="text-[15px] font-semibold text-ink-900">QuickBooks Online</h2>
        <p className="mt-1 text-sm text-ink-500">
          Each entity can be linked to its own QuickBooks company. Import accounts and sync transactions from the entity&apos;s page.
        </p>

        {connections.length > 0 ? (
          <ul className="mt-3 divide-y divide-ink-100">
            {connections.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <div>
                  <p className="font-medium text-ink-900">{c.companyName ?? "QuickBooks company"}</p>
                  <p className="text-xs text-ink-500">
                    {c.entityId ? (
                      <>
                        For{" "}
                        <Link href={`/entities/${c.entityId}`} className="font-medium text-accent-600 hover:text-accent-700">
                          {entityNames.get(c.entityId) ?? "an entity"}
                        </Link>
                      </>
                    ) : (
                      "Shared by all entities"
                    )}
                    {" · "}
                    {c.lastSyncedAt ? `Last synced ${timeAgo(c.lastSyncedAt)}` : "Not synced yet"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge status="matched" label="Connected" />
                  {canManage && <DisconnectQuickBooksButton connectionId={c.id} company={c.companyName} />}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-ink-500">Not connected. Connect a company to import its chart of accounts and ledger transactions.</p>
        )}

        {canManage && (
          <div className="mt-4 border-t border-ink-100 pt-4">
            <p className="mb-2 text-sm font-medium text-ink-800">{connections.length > 0 ? "Connect another QuickBooks company" : "Connect QuickBooks"}</p>
            <ConnectQuickBooksForm options={connectOptions} />
          </div>
        )}
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
