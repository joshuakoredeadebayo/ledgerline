import Link from "next/link";
import { ChevronLeft, Download } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { can } from "@/lib/permissions";
import { formatCurrency } from "@/lib/utils";
import { loadVatReport } from "@/lib/reports/vat-report";
import { categoryById, nextVatDue, VAT_CODE_LABELS, type VatCode } from "@/lib/vat";
import { EmptyState } from "@/components/shared/empty-state";
import { PrintButton } from "@/components/reports/print-button";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const CODES: VatCode[] = ["STD", "ZERO", "EXEMPT", "OUT"];

const fmtDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const monthTitle = (month: string) =>
  new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

export default async function VatReportPage({ searchParams }: { searchParams: Promise<{ entity?: string; period?: string }> }) {
  const sp = await searchParams;
  const membership = await getCurrentMembership();
  if (!membership) return null;
  if (!can(membership.role, "reports.view")) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState title="You don't have access to reports" description="Ask an owner if you need it." />
      </div>
    );
  }

  const supabase = (await createClient()) as any;
  const { data: entityRows } = await supabase.from("entities").select("id, name, vat_registered").is("archived_at", null).order("name");
  const entities: { id: string; name: string; vat_registered: boolean }[] = (entityRows ?? []).filter((e: any) => e.vat_registered);

  if (entities.length === 0) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Link href="/reports" className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-800">
          <ChevronLeft className="h-3.5 w-3.5" />
          Reports
        </Link>
        <EmptyState
          title="No entity is registered for VAT"
          description="Open an entity under Entities and choose VAT settings to switch VAT on. Then record sales and purchases with the VAT helper in Journal entries."
        />
      </div>
    );
  }

  const entityId = entities.find((e) => e.id === sp.entity)?.id ?? entities[0]!.id;
  const month = MONTH_RE.test(sp.period ?? "") ? (sp.period as string) : nextVatDue(new Date()).period;
  const report = await loadVatReport(supabase, entityId, month);
  if (!report) return null;

  const { summary: s, entity: e } = report;
  const cur = e.currency;
  const today = new Date().toISOString().slice(0, 10);
  const overdue = report.dueDate < today;

  const bucketRows = (title: string, buckets: typeof s.salesByCode) => (
    <section className="print-avoid-break rounded-xl border border-ink-100 bg-white shadow-subtle print:shadow-none">
      <div className="border-b border-ink-100 px-5 py-3">
        <h2 className="text-[15px] font-semibold text-ink-900">{title}</h2>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-ink-100 bg-ink-50 text-left text-xs font-medium text-ink-500">
            <th className="px-5 py-2 font-medium">VAT treatment</th>
            <th className="px-3 py-2 text-right font-medium">Entries</th>
            <th className="px-3 py-2 text-right font-medium">Net amount</th>
            <th className="px-5 py-2 text-right font-medium">VAT</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {CODES.map((c) => (
            <tr key={c}>
              <td className="px-5 py-2.5 text-ink-800">{VAT_CODE_LABELS[c]}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-ink-600">{buckets[c].count}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-ink-900">{formatCurrency(buckets[c].base, cur)}</td>
              <td className="px-5 py-2.5 text-right tabular-nums text-ink-900">{formatCurrency(buckets[c].vat, cur)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="print:hidden">
        <Link href="/reports" className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-800">
          <ChevronLeft className="h-3.5 w-3.5" />
          Reports
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-ink-900">VAT summary</h1>
        <p className="mt-1 text-sm text-ink-500">Output VAT, input VAT and the net amount for a month, from the VAT-tagged journal entries posted in Ledgerline.</p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-ink-100 bg-white p-4 shadow-subtle print:hidden">
        <label className="flex min-w-[14rem] flex-1 flex-col gap-1.5 text-sm font-medium text-ink-700">
          Entity
          <select
            name="entity"
            defaultValue={entityId}
            className="h-9 rounded border border-ink-200 bg-white px-2.5 text-sm font-normal text-ink-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
          >
            {entities.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
          Month
          <input
            type="month"
            name="period"
            defaultValue={month}
            className="h-9 rounded border border-ink-200 bg-white px-2.5 text-sm font-normal text-ink-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
          />
        </label>
        <button type="submit" className="h-9 rounded bg-accent-500 px-4 text-sm font-medium text-white hover:bg-accent-600">
          Run report
        </button>
      </form>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">VAT summary</p>
          <h2 className="mt-0.5 text-xl font-semibold text-ink-900">
            {e.name} · {monthTitle(month)}
          </h2>
          <p className="text-sm text-ink-600">
            {e.vatNumber ? `VAT number ${e.vatNumber} · ` : ""}Rate {e.rate}% · {cur}
          </p>
          <p className={`mt-1 text-sm ${overdue ? "font-medium text-status-exception" : "text-ink-600"}`}>
            Return and payment due {fmtDate(report.dueDate)}
            {overdue ? " (past due)" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <a
            href={`/api/reports/vat?entity=${e.id}&period=${month}`}
            className="inline-flex h-9 items-center gap-2 rounded border border-ink-200 bg-white px-4 text-sm font-medium text-ink-800 hover:bg-ink-50"
          >
            <Download className="h-4 w-4" />
            CSV
          </a>
          <PrintButton />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="print-avoid-break rounded-xl border border-ink-100 bg-white p-5 shadow-subtle print:shadow-none">
          <p className="text-xs text-ink-500">Output VAT (charged on sales)</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-ink-900">{formatCurrency(s.outputVat, cur)}</p>
        </div>
        <div className="print-avoid-break rounded-xl border border-ink-100 bg-white p-5 shadow-subtle print:shadow-none">
          <p className="text-xs text-ink-500">Input VAT you can reclaim ({e.recoverablePercent}% of {formatCurrency(s.inputVat, cur)})</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-ink-900">{formatCurrency(s.recoverableInputVat, cur)}</p>
        </div>
        <div className="print-avoid-break rounded-xl border border-accent-300 bg-accent-50 p-5 shadow-subtle print:shadow-none">
          <p className="text-xs text-ink-600">{s.netPayable < 0 ? "VAT refundable (credit)" : "Net VAT payable"}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-accent-700">{formatCurrency(Math.abs(s.netPayable), cur)}</p>
        </div>
      </div>

      {bucketRows("Sales", s.salesByCode)}
      {bucketRows("Purchases", s.purchasesByCode)}

      <section className="rounded-xl border border-ink-100 bg-white shadow-subtle print:shadow-none">
        <div className="border-b border-ink-100 px-5 py-3">
          <h2 className="text-[15px] font-semibold text-ink-900">
            Entries included <span className="font-normal text-ink-500">({report.records.length})</span>
          </h2>
        </div>
        {report.records.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-100 bg-ink-50 text-left text-xs font-medium text-ink-500">
                  <th className="px-5 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Description</th>
                  <th className="px-3 py-2 font-medium">Type of supply</th>
                  <th className="px-3 py-2 font-medium">Treatment</th>
                  <th className="px-3 py-2 text-right font-medium">Net amount</th>
                  <th className="px-5 py-2 text-right font-medium">VAT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {report.records.map((r, i) => (
                  <tr key={`${r.entryId}-${i}`} className="align-top">
                    <td className="whitespace-nowrap px-5 py-2.5 text-ink-600">
                      <Link href={`/journal-entries/${r.entryId}`} className="hover:text-accent-700">
                        {fmtDate(r.entryDate)}
                      </Link>
                    </td>
                    <td className="max-w-xs px-3 py-2.5 text-ink-900">
                      {r.description ?? "—"}
                      <span className="block text-xs text-ink-400">{r.direction === "sales" ? "Sale" : "Purchase"}</span>
                    </td>
                    <td className="px-3 py-2.5 text-ink-700">{categoryById(r.category)?.label ?? r.category}</td>
                    <td className="px-3 py-2.5 text-ink-700">{VAT_CODE_LABELS[r.code]}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-ink-900">{formatCurrency(r.base, cur)}</td>
                    <td className="whitespace-nowrap px-5 py-2.5 text-right tabular-nums text-ink-900">{formatCurrency(r.vat, cur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-5 py-6 text-sm text-ink-500">No VAT-tagged entries were posted for this month.</p>
        )}
      </section>

      <p className="text-xs leading-relaxed text-ink-500">
        This summary covers journal entries recorded and posted in Ledgerline with the VAT helper. It does not include sales and purchases that live only in your
        accounting or invoicing system. It supports preparing a return; it is not tax advice, and the return is filed with the tax authority, not here. Check unusual
        treatments, the small-business threshold and any input VAT apportionment with a qualified tax adviser. Generated{" "}
        {new Date().toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })} by {membership.email}.
      </p>
    </div>
  );
}
