import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { can } from "@/lib/permissions";
import { EmptyState } from "@/components/shared/empty-state";
import { StatementImport } from "@/components/reconciliation/statement-import";

export default async function ImportStatementPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const membership = await getCurrentMembership();
  if (!membership) return null;
  if (!can(membership.role, "reconciliation.match")) redirect(`/reconciliation/${accountId}`);

  const supabase = (await createClient()) as any;
  const { data: account } = await supabase
    .from("accounts")
    .select("id, name, is_reconcilable, archived_at, entities(name, currency)")
    .eq("id", accountId)
    .maybeSingle();
  if (!account) notFound();

  const { data: sibling } = await supabase.from("transactions").select("currency").eq("account_id", accountId).limit(1).maybeSingle();
  const currency = sibling?.currency ?? account.entities?.currency ?? "USD";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link href={`/reconciliation/${accountId}`} className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-800">
          <ChevronLeft className="h-3.5 w-3.5" />
          {account.name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-ink-900">Import a statement</h1>
        <p className="mt-1 text-sm text-ink-500">
          Bring bank or wallet transactions into <span className="font-medium text-ink-800">{account.entities?.name} · {account.name}</span> from a CSV file. They
          appear as bank transactions, ready to match against your ledger.
        </p>
      </div>

      {account.archived_at || !account.is_reconcilable ? (
        <EmptyState
          title="This account can't take a statement yet"
          description={account.archived_at ? "It is archived. Restore it first." : "Switch Reconciliation on for this account (Entities → Edit), then come back."}
        />
      ) : (
        <StatementImport accountId={accountId} accountName={account.name} currency={currency} />
      )}
    </div>
  );
}
