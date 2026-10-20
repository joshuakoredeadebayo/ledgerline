import { fetchAll } from "@/lib/fetch-all";
import { monthBounds } from "@/lib/reports/reconciliation-report";
import { summarizeVat, vatDueDate, type VatLineRecord, type VatSummary } from "@/lib/vat";

export interface VatReport {
  entity: { id: string; name: string; currency: string; registered: boolean; vatNumber: string | null; rate: number; recoverablePercent: number };
  month: string;
  dueDate: string;
  records: VatLineRecord[];
  summary: VatSummary;
}

/**
 * The VAT picture for one entity and month, from posted journal entries that carry VAT tags. Reversed
 * entries and the entries that reverse them are left out, since together they cancel.
 */
export async function loadVatReport(supabase: any, entityId: string, month: string): Promise<VatReport | null> {
  const { data: entity } = await supabase
    .from("entities")
    .select("id, name, currency, vat_registered, vat_number, vat_rate, vat_input_recoverable_percent")
    .eq("id", entityId)
    .maybeSingle();
  if (!entity) return null;

  const { start, end } = monthBounds(month);
  const rows = await fetchAll<any>((from, to) =>
    supabase
      .from("journal_entry_lines")
      .select(
        "id, debit, credit, vat_code, vat_direction, vat_rate, vat_amount, vat_category, journal_entries!inner(id, entry_date, description, status, reversed_entry_id, entity_id)"
      )
      .not("vat_code", "is", null)
      .eq("journal_entries.entity_id", entityId)
      .eq("journal_entries.status", "posted")
      .is("journal_entries.reversed_entry_id", null)
      .gte("journal_entries.entry_date", start)
      .lte("journal_entries.entry_date", end)
      .order("id")
      .range(from, to)
  );

  const records: VatLineRecord[] = rows
    .map((r) => ({
      entryId: r.journal_entries.id as string,
      entryDate: String(r.journal_entries.entry_date).slice(0, 10),
      description: (r.journal_entries.description as string | null) ?? null,
      direction: r.vat_direction,
      code: r.vat_code,
      category: r.vat_category ?? "",
      rate: Number(r.vat_rate ?? 0),
      base: Number(r.debit) + Number(r.credit),
      vat: Number(r.vat_amount),
    }))
    .sort((a, b) => a.entryDate.localeCompare(b.entryDate));

  const recoverablePercent = Number(entity.vat_input_recoverable_percent ?? 100);
  return {
    entity: {
      id: entity.id,
      name: entity.name,
      currency: entity.currency,
      registered: !!entity.vat_registered,
      vatNumber: entity.vat_number ?? null,
      rate: Number(entity.vat_rate ?? 7.5),
      recoverablePercent,
    },
    month,
    dueDate: vatDueDate(month),
    records,
    summary: summarizeVat(records, recoverablePercent),
  };
}
