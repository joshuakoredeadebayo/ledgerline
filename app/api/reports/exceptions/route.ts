import { getCurrentMembership } from "@/lib/actions/membership";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/permissions";
import { csvResponse, toCsv } from "@/lib/csv";
import { loadExceptionAging } from "@/lib/reports/exception-aging";

export async function GET(request: Request) {
  const membership = await getCurrentMembership();
  if (!membership) return new Response("Not signed in.", { status: 401 });
  if (!can(membership.role, "reports.view")) return new Response("Forbidden.", { status: 403 });

  const entityId = new URL(request.url).searchParams.get("entity") || undefined;
  const supabase = (await createClient()) as any;
  const rows = await loadExceptionAging(supabase, entityId);

  const csv = toCsv(
    ["Age (days)", "Age group", "Opened", "Entity", "Account", "Transaction date", "Description", "Amount", "Currency", "Type", "Severity"],
    rows.map((r) => [r.ageDays, r.bucket, r.openedOn, r.entityName, r.accountName, r.transactionDate, r.description ?? "", r.amount, r.currency, r.type, r.severity])
  );
  return csvResponse(csv, `exceptions-aging-${new Date().toISOString().slice(0, 10)}.csv`);
}
