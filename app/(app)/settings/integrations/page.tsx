import { getCurrentMembership } from "@/lib/actions/membership";
import { can } from "@/lib/permissions";
import { getQuickBooksConnection } from "@/lib/actions/quickbooks";
import { DisconnectQuickBooksButton } from "@/components/quickbooks/disconnect-button";
import { Button } from "@/components/ui/button";

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const { connected, error } = await searchParams;
  const membership = await getCurrentMembership();
  const canManage = membership ? can(membership.role, "org.manage_integrations") : false;
  const connection = await getQuickBooksConnection();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Integrations</h1>
        <p className="mt-1 text-sm text-ink-500">Connect external accounting systems to Ledgerline.</p>
      </div>

      {connected && (
        <div className="rounded-md border border-status-success/30 bg-status-success/10 p-3 text-sm text-status-success">
          QuickBooks connected successfully.
        </div>
      )}
      {error && (
        <div className="rounded-md border border-status-exception/30 bg-status-exception/10 p-3 text-sm text-status-exception">
          Could not connect QuickBooks: {decodeURIComponent(error)}
        </div>
      )}

      <div className="rounded-lg border border-ink-100 bg-white p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-medium text-ink-900">QuickBooks Online</h2>
            {connection ? (
              <p className="mt-1 text-sm text-ink-500">
                Connected to <span className="font-medium text-ink-700">{connection.companyName}</span>
              </p>
            ) : (
              <p className="mt-1 text-sm text-ink-500">Not connected.</p>
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
      </div>
    </div>
  );
}
