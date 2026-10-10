import { getCurrentMembership } from "@/lib/actions/membership";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/permissions";
import { csvResponse, toCsv } from "@/lib/csv";
import { loadPeriodSummary } from "@/lib/reports/period-summary";

export async function GET(request: Request) {
  const membership = await getCurrentMembership();
  if (!membership) return new Response("Not signed in.", { status: 401 });
  if (!can(membership.role, "reports.view")) return new Response("Forbidden.", { status: 403 });

  const month = new URL(request.url).searchParams.get("period") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return new Response("Choose a month.", { status: 400 });

  const supabase = (await createClient()) as any;
  const rows = await loadPeriodSummary(supabase, month);
  const { data: roster } = await supabase.rpc("list_org_members", { p_org: membership.organizationId });
  const emails = new Map<string, string>(((roster ?? []) as any[]).map((m) => [m.user_id, m.email]));

  const csv = toCsv(
    ["Entity", "Account", "Currency", "Status", "Ledger total", "Bank total", "Unexplained difference", "Open exceptions", "Unmatched transactions", "Finalized by", "Finalized at"],
    rows.map((r) => [
      r.entityName,
      r.accountName,
      r.currency,
      r.status,
      r.bookTotal ?? "",
      r.externalTotal ?? "",
      r.difference ?? "",
      r.openExceptions,
      r.unmatched,
      r.finalizedBy ? (emails.get(r.finalizedBy) ?? "a former member") : "",
      r.finalizedAt ?? "",
    ])
  );
  return csvResponse(csv, `period-summary-${month}.csv`);
}
