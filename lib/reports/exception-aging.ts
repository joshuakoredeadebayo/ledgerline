import { fetchAll } from "@/lib/fetch-all";

export const AGE_BUCKETS = [
  { key: "0-7", label: "Up to 7 days", min: 0, max: 7 },
  { key: "8-30", label: "8 to 30 days", min: 8, max: 30 },
  { key: "31-60", label: "31 to 60 days", min: 31, max: 60 },
  { key: "61+", label: "Over 60 days", min: 61, max: Number.POSITIVE_INFINITY },
] as const;

export interface AgingRow {
  id: string;
  ageDays: number;
  bucket: string;
  openedOn: string;
  severity: string;
  type: string;
  description: string | null;
  transactionDate: string;
  amount: number;
  currency: string;
  accountId: string;
  accountName: string;
  entityName: string;
}

export function bucketFor(ageDays: number): string {
  return AGE_BUCKETS.find((b) => ageDays >= b.min && ageDays <= b.max)?.key ?? "61+";
}

/** Every open exception with how long it has been open, oldest first. Complete, not capped at 1,000. */
export async function loadExceptionAging(supabase: any, entityId?: string): Promise<AgingRow[]> {
  const rows = await fetchAll<any>((from, to) => {
    let query = supabase
      .from("exceptions")
      .select(
        "id, exception_type, severity, created_at, transactions(amount, currency, transaction_date, description, account_id, accounts(name, entities(name)))"
      )
      .eq("status", "open")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
    if (entityId) query = query.eq("entity_id", entityId);
    return query;
  });

  const now = Date.now();
  return rows.map((e) => {
    const ageDays = Math.max(0, Math.floor((now - new Date(e.created_at).getTime()) / 86_400_000));
    const t = e.transactions;
    return {
      id: e.id,
      ageDays,
      bucket: bucketFor(ageDays),
      openedOn: String(e.created_at).slice(0, 10),
      severity: e.severity,
      type: e.exception_type,
      description: t?.description ?? null,
      transactionDate: t?.transaction_date ? String(t.transaction_date).slice(0, 10) : "",
      amount: Number(t?.amount ?? 0),
      currency: t?.currency ?? "USD",
      accountId: t?.account_id ?? "",
      accountName: t?.accounts?.name ?? "",
      entityName: t?.accounts?.entities?.name ?? "",
    };
  });
}
