import { getCurrentMembership } from "@/lib/actions/membership";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/permissions";
import { csvResponse, toCsv } from "@/lib/csv";
import { loadVatReport } from "@/lib/reports/vat-report";
import { categoryById, VAT_CODE_LABELS } from "@/lib/vat";

export async function GET(request: Request) {
  const membership = await getCurrentMembership();
  if (!membership) return new Response("Not signed in.", { status: 401 });
  if (!can(membership.role, "reports.view")) return new Response("Forbidden.", { status: 403 });

  const url = new URL(request.url);
  const entityId = url.searchParams.get("entity") ?? "";
  const month = url.searchParams.get("period") ?? "";
  if (!entityId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return new Response("Choose an entity and a month.", { status: 400 });

  const supabase = (await createClient()) as any;
  const report = await loadVatReport(supabase, entityId, month);
  if (!report) return new Response("Entity not found.", { status: 404 });

  const { summary: s } = report;
  const header = ["Section", "Date", "Description", "Type of supply", "VAT treatment", "Rate %", "Net amount", "VAT"];
  const summaryRows: unknown[][] = [
    ["Summary", "", `${report.entity.name} (${report.entity.currency})`, "", report.entity.vatNumber ? `VAT number ${report.entity.vatNumber}` : "", "", "", ""],
    ["Summary", "", `Period ${month}`, "", `Due ${report.dueDate}`, "", "", ""],
    ["Output VAT", "", "VAT charged on sales", "", "", "", "", s.outputVat],
    ["Input VAT", "", "VAT paid on purchases", "", "", "", "", s.inputVat],
    ["Recoverable input VAT", "", `${report.entity.recoverablePercent}% of input VAT`, "", "", "", "", s.recoverableInputVat],
    ["Net VAT payable (negative = refundable)", "", "", "", "", "", "", s.netPayable],
    [],
  ];
  const detail = report.records.map((r) => [
    r.direction === "sales" ? "Sale" : "Purchase",
    r.entryDate,
    r.description ?? "",
    categoryById(r.category)?.label ?? r.category,
    VAT_CODE_LABELS[r.code],
    r.rate,
    r.base,
    r.vat,
  ]);

  const safe = report.entity.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  return csvResponse(toCsv(header, [...summaryRows, ...detail]), `vat-${safe}-${month}.csv`);
}
