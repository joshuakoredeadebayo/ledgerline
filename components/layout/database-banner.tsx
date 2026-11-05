import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

const FILE_NAMES: Record<string, string> = {
  "0008": "0008_members_and_invitations.sql",
  "0009": "0009_entity_management.sql",
  "0010": "0010_reconciliation_workflow.sql",
  "0011": "0011_quickbooks_per_entity.sql",
  "0012": "0012_journal_entries.sql",
  "0013": "0013_balance_reconciliation.sql",
  "0014": "0014_vat.sql",
  "0015": "0015_collaboration.sql",
  "0016": "0016_quickbooks_journal_writeback.sql",
};

export interface SchemaCheck {
  migration: string;
  description: string;
  applied: boolean;
}

/** Reads the built-in database check. Returns null when the check itself hasn't been installed (update 0017). */
export async function loadSchemaHealth(): Promise<SchemaCheck[] | null> {
  try {
    const supabase = (await createClient()) as any;
    const { data, error } = await supabase.rpc("schema_health");
    if (error || !data) return null;
    return data as SchemaCheck[];
  } catch {
    return null;
  }
}

export const sqlFileFor = (migration: string) => FILE_NAMES[migration] ?? `${migration}.sql`;

/** A banner shown to owners and admins when the app is ahead of the database, so nothing fails silently. */
export async function DatabaseBanner({ role }: { role: string }) {
  if (role !== "owner" && role !== "admin") return null;
  const checks = await loadSchemaHealth();
  const missing = (checks ?? []).filter((c) => !c.applied);
  if (missing.length === 0) return null;

  return (
    <div role="alert" className="mb-5 flex items-start gap-3 rounded-lg border border-status-pending/40 bg-status-pendingBg px-4 py-3 text-sm text-ink-900">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-pending" />
      <p>
        <span className="font-semibold">Your database is missing {missing.length === 1 ? "an update" : `${missing.length} updates`}.</span> Some pages may look empty or
        have features switched off until {missing.length === 1 ? "it is" : "they are"} run in the Supabase SQL editor:{" "}
        {missing.map((m, i) => (
          <span key={m.migration} className="font-medium">
            {sqlFileFor(m.migration)}
            {i < missing.length - 1 ? ", " : ""}
          </span>
        ))}
        .{" "}
        <Link href="/settings/organization" className="font-medium text-accent-700 underline">
          See details
        </Link>
      </p>
    </div>
  );
}
