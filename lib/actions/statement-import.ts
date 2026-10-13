"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { assertPermission } from "@/lib/permissions";
import { getOrCreateReconciliationPeriod, recomputeReconciliationStatus } from "@/lib/reconciliation-status";

export interface ImportRowInput {
  rowNumber: number;
  date: string;
  description: string;
  /** Positive = money out, negative = money in. */
  amount: number;
  balance: number | null;
  reference: string | null;
  occurrence: number;
}

const MAX_ROWS_PER_BATCH = 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const validDate = (iso: string) => {
  if (!DATE_RE.test(iso)) return false;
  const d = new Date(`${iso}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
};

/**
 * Saves one batch of statement rows as bank-side transactions on an account. Large files arrive in
 * several batches. Each row gets a fingerprint from its account, date, amount, description and
 * reference (plus which copy of an identical row it is), so importing the same statement again, or
 * an overlapping one, skips rows already there instead of duplicating them.
 */
export async function importStatementBatch(input: {
  accountId: string;
  batchId: string;
  fileName: string;
  rows: ImportRowInput[];
}): Promise<{ error?: string; inserted?: number; duplicates?: number }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  assertPermission(membership.role, "reconciliation.match");

  if (input.rows.length === 0) return { inserted: 0, duplicates: 0 };
  if (input.rows.length > MAX_ROWS_PER_BATCH) return { error: `Send at most ${MAX_ROWS_PER_BATCH} rows at a time.` };

  for (const r of input.rows) {
    if (!validDate(r.date)) return { error: `Row ${r.rowNumber}: invalid date.` };
    if (!Number.isFinite(r.amount) || r.amount === 0 || Math.abs(r.amount) >= 1e12) return { error: `Row ${r.rowNumber}: invalid amount.` };
    if (Math.abs(r.amount * 100 - Math.round(r.amount * 100)) > 1e-6) {
      return { error: `Row ${r.rowNumber}: amounts can have at most two decimal places.` };
    }
  }

  const supabase = (await createClient()) as any;
  const { data: account } = await supabase
    .from("accounts")
    .select("id, entity_id, is_reconcilable, archived_at, entities(currency, archived_at)")
    .eq("id", input.accountId)
    .maybeSingle();
  if (!account) return { error: "Account not found." };
  if (account.archived_at || account.entities?.archived_at) return { error: "This account is archived." };
  if (!account.is_reconcilable) return { error: "Switch Reconciliation on for this account before importing a statement." };

  // A finalized month must not change underneath its sign-off.
  const months = [...new Set(input.rows.map((r) => r.date.slice(0, 7)))];
  const { data: finalized } = await supabase
    .from("reconciliations")
    .select("period_start")
    .eq("account_id", input.accountId)
    .eq("status", "finalized")
    .in("period_start", months.map((m) => `${m}-01`));
  if (finalized && finalized.length > 0) {
    const names = (finalized as { period_start: string }[]).map((f) => f.period_start.slice(0, 7)).join(", ");
    return { error: `${names} ${finalized.length === 1 ? "is" : "are"} finalized for this account. Reopen the period first, or remove those rows from the file.` };
  }

  const { data: sibling } = await supabase.from("transactions").select("currency").eq("account_id", input.accountId).limit(1).maybeSingle();
  const currency = sibling?.currency ?? account.entities?.currency ?? "USD";

  const records = input.rows.map((r) => {
    const fingerprint = createHash("sha256")
      .update([input.accountId, r.date, r.amount.toFixed(2), r.description.trim().toLowerCase(), r.reference ?? "", r.occurrence].join("|"))
      .digest("hex")
      .slice(0, 40);
    return {
      entity_id: account.entity_id,
      account_id: input.accountId,
      source: "manual",
      external_id: `stmt-${fingerprint}`,
      amount: r.amount,
      currency,
      transaction_date: r.date,
      description: r.description.trim().slice(0, 300),
      raw_payload: {
        side: "bank",
        imported: true,
        import_batch: input.batchId,
        file: input.fileName.slice(0, 200),
        row: r.rowNumber,
        balance: r.balance,
        reference: r.reference,
      },
      status: "unmatched",
    };
  });

  // Skip rows already imported. This looks them up first instead of relying on a database
  // conflict rule, so it works the same whatever constraints the live table happens to have.
  const existing = new Set<string>();
  for (let i = 0; i < records.length; i += 150) {
    const ids = records.slice(i, i + 150).map((r) => r.external_id);
    const { data: found, error: lookupError } = await supabase
      .from("transactions")
      .select("external_id")
      .eq("account_id", input.accountId)
      .in("external_id", ids);
    if (lookupError) return { error: lookupError.message };
    for (const f of found ?? []) existing.add(f.external_id);
  }
  const fresh = records.filter((r) => !existing.has(r.external_id));

  if (fresh.length > 0) {
    const { error } = await supabase.from("transactions").insert(fresh);
    if (error) {
      if (error.code === "23505") return { error: "Some of these rows were imported a moment ago by another import. Try again." };
      return { error: error.message };
    }
  }

  return { inserted: fresh.length, duplicates: records.length - fresh.length };
}

/** Called once after the last batch: refreshes the affected months and records the import in the audit log. */
export async function finishStatementImport(input: {
  accountId: string;
  batchId: string;
  fileName: string;
  inserted: number;
  duplicates: number;
  skippedRows: number;
  months: string[];
}): Promise<{ error?: string }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  assertPermission(membership.role, "reconciliation.match");

  const supabase = (await createClient()) as any;
  const { data: account } = await supabase.from("accounts").select("id, entity_id").eq("id", input.accountId).maybeSingle();
  if (!account) return { error: "Account not found." };

  await supabase.from("audit_log").insert({
    organization_id: membership.organizationId,
    entity_id: account.entity_id,
    actor_id: membership.userId,
    action: "statement.imported",
    target_table: "accounts",
    target_id: input.accountId,
    after: {
      file: input.fileName.slice(0, 200),
      batch: input.batchId,
      inserted: input.inserted,
      duplicates: input.duplicates,
      rows_skipped: input.skippedRows,
    },
  });

  // Refresh each affected month so totals, suggestions and exceptions reflect the new rows.
  for (const month of [...new Set(input.months)].filter((m) => /^\d{4}-\d{2}$/.test(m)).slice(0, 36)) {
    try {
      const reconciliationId = await getOrCreateReconciliationPeriod(account.entity_id, input.accountId, `${month}-15T12:00:00.000Z`, membership.userId);
      await recomputeReconciliationStatus(reconciliationId);
    } catch (err) {
      console.error("Statement import: recompute failed for", month, err);
    }
  }

  revalidatePath(`/reconciliation/${input.accountId}`);
  revalidatePath("/reconciliation", "layout");
  revalidatePath("/dashboard");
  revalidatePath("/reports", "layout");
  return {};
}
