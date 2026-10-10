import { getCurrentMembership } from "@/lib/actions/membership";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/permissions";
import { csvResponse, toCsv } from "@/lib/csv";
import { loadReconciliationReport, reconciliationReportCsvRows, RECONCILIATION_CSV_HEADER } from "@/lib/reports/reconciliation-report";

export async function GET(request: Request) {
  const membership = await getCurrentMembership();
  if (!membership) return new Response("Not signed in.", { status: 401 });
  if (!can(membership.role, "reports.view")) return new Response("Forbidden.", { status: 403 });

  const url = new URL(request.url);
  const accountId = url.searchParams.get("account") ?? "";
  const month = url.searchParams.get("period") ?? "";
  if (!accountId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return new Response("Choose an account and a month.", { status: 400 });

  const supabase = (await createClient()) as any;
  const report = await loadReconciliationReport(supabase, accountId, month);
  if (!report) return new Response("Account not found.", { status: 404 });

  const { data: roster } = await supabase.rpc("list_org_members", { p_org: membership.organizationId });
  const emails = new Map<string, string>(((roster ?? []) as any[]).map((m) => [m.user_id, m.email]));
  const nameOf = (id: string | null) => (id ? (emails.get(id) ?? "a former member") : "");

  const rows = reconciliationReportCsvRows(report, nameOf);
  const r = report.reconciliation;
  // A short summary block ahead of the detail rows, so the file stands on its own.
  const summary: unknown[][] = [
    ["Summary", `${report.account.entityName} · ${report.account.name}`, "", "", "", "", "", "", "", `${month} (${report.account.currency})`, ""],
    ["Status", r?.status ?? "not started", "", "", "", "", "", "", "", "", ""],
    ["Ledger total", "", "", r?.bookTotal ?? "", "", "", "", "", "", "", ""],
    ["Bank total", "", "", r?.externalTotal ?? "", "", "", "", "", "", "", ""],
    ["Unexplained difference", "", "", r?.difference ?? "", "", "", "", "", "", "", ""],
    ["Finalized by", r?.finalizedBy ? nameOf(r.finalizedBy) : "Not finalized", "", "", "", "", "", "", "", r?.finalizedAt ?? "", ""],
    [],
  ];

  const safeName = report.account.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  return csvResponse(toCsv(RECONCILIATION_CSV_HEADER, [...summary, ...rows]), `reconciliation-${safeName}-${month}.csv`);
}
