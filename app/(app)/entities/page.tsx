import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { can } from "@/lib/permissions";
import { EmptyState } from "@/components/shared/empty-state";
import { Building2 } from "lucide-react";
import { CreateEntityForm } from "@/components/entities/create-entity-form";
import { ConnectBankButton } from "@/components/plaid/connect-bank-button";
import Link from "next/link";

export default async function EntitiesPage() {
  const membership = await getCurrentMembership();
  const supabase = await createClient();

  const { data: entities } = await supabase
    .from("entities")
    .select("id, name, currency, created_at")
    .order("created_at", { ascending: true });

  const canManage = membership ? can(membership.role, "entities.manage") : false;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">Entities</h1>
          <p className="mt-1 text-sm text-ink-500">
            Legal entities within your organization. Each one has its own chart of accounts and books.
          </p>
        </div>
      </div>

      {canManage && (
        <div className="flex flex-wrap gap-3">
          <CreateEntityForm />
          {entities && entities.length > 0 && (
            <ConnectBankButton entities={entities.map((e) => ({ id: e.id, name: e.name }))} />
          )}
        </div>
      )}

      {entities && entities.length > 0 ? (
        <div className="divide-y divide-ink-100 rounded-lg border border-ink-100 bg-white">
          {entities.map((entity) => (
            <Link
              key={entity.id}
              href={`/entities/${entity.id}`}
              className="flex items-center justify-between px-4 py-3 hover:bg-ink-50"
            >
              <div className="flex items-center gap-3">
                <Building2 className="h-4 w-4 text-ink-400" />
                <span className="text-sm font-medium text-ink-900">{entity.name}</span>
              </div>
              <span className="text-xs text-ink-500">{entity.currency}</span>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Building2 className="h-8 w-8" />}
          title="No entities yet"
          description="Add your first legal entity to start setting up accounts and reconciliation."
        />
      )}
    </div>
  );
}
