import { AlertTriangle, ClipboardCheck, GitMerge } from "lucide-react";
import { getCurrentMembership } from "@/lib/actions/membership";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateReconciliationPeriod, recomputeReconciliationStatus } from "@/lib/reconciliation-status";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";

export default async function DashboardPage() {
  const membership = await getCurrentMembership();
  const supabase = await createClient();

  // Refresh every account's reconciliation status across the org before
  // reading the counts below — otherwise these numbers only reflect
  // whatever was last true the moment someone happened to open that
  // specific account's reconciliation page, not the current truth.
  if (membership) {
    const { data: entities } = await supabase.from("entities").select("id").eq("organization_id", membership.organizationId);
    for (const entity of entities ?? []) {
      const { data: accounts } = await supabase.from("accounts").select("id").eq("entity_id", entity.id);
      for (const account of accounts ?? []) {
        const reconciliationId = await getOrCreateReconciliationPeriod(
          entity.id,
          account.id,
          new Date().toISOString(),
          membership.userId
        );
        await recomputeReconciliationStatus(reconciliationId);
      }
    }
  }

  const { count: openExceptions } = await supabase
    .from("exceptions")
    .select("id", { count: "exact", head: true })
    .eq("status", "open");

  const { count: pendingMatches } = await supabase
    .from("matches")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending_review");

  const { data: openPeriods } = await supabase
    .from("close_periods")
    .select("id, period_start, period_end, status")
    .neq("status", "locked")
    .order("period_end", { ascending: false })
    .limit(1);

  // Used to tailor the empty-state message below — someone who's already
  // set up an account shouldn't be told to go "connect" one again.
  const { count: accountCount } = await supabase
    .from("accounts")
    .select("id", { count: "exact", head: true });

  const hasActivity = (openExceptions ?? 0) > 0 || (pendingMatches ?? 0) > 0 || (openPeriods?.length ?? 0) > 0;
  const hasAccount = (accountCount ?? 0) > 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">
          Good to see you, {membership?.email.split("@")[0]}.
        </h1>
        <p className="mt-1 text-sm text-ink-500">Here&apos;s what needs attention across {membership?.organizationName}.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Open exceptions"
          value={openExceptions ?? 0}
          tone={openExceptions ? "exception" : "neutral"}
          href="/reconciliation"
        />
        <SummaryCard
          icon={<GitMerge className="h-4 w-4" />}
          label="Matches pending review"
          value={pendingMatches ?? 0}
          tone={pendingMatches ? "pending" : "neutral"}
          href="/reconciliation"
        />
        <SummaryCard
          icon={<ClipboardCheck className="h-4 w-4" />}
          label="Open close period"
          value={(openPeriods as { status: string }[] | null)?.[0]?.status ?? "None"}
          tone="info"
          href="/close"
        />
      </div>

      {!hasActivity && (
        <EmptyState
          title="Nothing needs attention right now"
          description={
            hasAccount
              ? "Your first account is set up. Once bank or ledger transactions sync in, unmatched items and close tasks will show up here."
              : "Once your bank and ledger accounts sync, unmatched transactions and close tasks will show up here."
          }
          action={
            hasAccount ? undefined : (
              <a
                href="/entities"
                className="text-sm font-medium text-accent-600 hover:text-accent-700"
              >
                Set up your first account →
              </a>
            )
          }
        />
      )}
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  tone,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  tone: "exception" | "pending" | "info" | "neutral";
  href: string;
}) {
  return (
    <a
      href={href}
      className="block rounded-lg border border-ink-100 bg-white p-4 transition-shadow hover:shadow-subtle"
    >
      <div className="flex items-center gap-2 text-ink-500">
        {icon}
        <span className="text-sm">{label}</span>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-2xl font-semibold tabular-nums text-ink-900">{value}</span>
        {typeof value === "number" && value > 0 && <Badge status={tone === "neutral" ? "neutral" : tone} />}
      </div>
    </a>
  );
}
