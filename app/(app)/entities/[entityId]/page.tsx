import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { can } from "@/lib/permissions";
import { EmptyState } from "@/components/shared/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Landmark } from "lucide-react";
import { CreateAccountForm } from "@/components/entities/create-account-form";

export default async function EntityDetailPage({ params }: { params: Promise<{ entityId: string }> }) {
  const { entityId } = await params;
  const membership = await getCurrentMembership();
  const supabase = await createClient();

  const { data: entity } = await supabase.from("entities").select("id, name, currency").eq("id", entityId).single();
  if (!entity) notFound();

  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, name, code, account_type, is_reconcilable")
    .eq("entity_id", entityId)
    .order("account_type");

  const canManage = membership ? can(membership.role, "entities.manage") : false;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Entity</p>
        <h1 className="text-2xl font-semibold text-ink-900">{entity.name}</h1>
        <p className="mt-1 text-sm text-ink-500">Chart of accounts · {entity.currency}</p>
      </div>

      {canManage && <CreateAccountForm entityId={entity.id} />}

      {accounts && accounts.length > 0 ? (
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>Account</TableHeaderCell>
              <TableHeaderCell>Code</TableHeaderCell>
              <TableHeaderCell>Type</TableHeaderCell>
              <TableHeaderCell>Reconciliation</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {accounts.map((account) => (
              <TableRow key={account.id}>
                <TableCell className="font-medium">{account.name}</TableCell>
                <TableCell>{account.code ?? "—"}</TableCell>
                <TableCell className="capitalize">{account.account_type}</TableCell>
                <TableCell>
                  <Badge status={account.is_reconcilable ? "info" : "neutral"} label={account.is_reconcilable ? "Enabled" : "Off"} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <EmptyState
          icon={<Landmark className="h-8 w-8" />}
          title="No accounts yet"
          description="Add accounts to this entity's chart of accounts to start reconciling transactions."
        />
      )}
    </div>
  );
}
