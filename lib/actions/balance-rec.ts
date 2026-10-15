"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { assertPermission } from "@/lib/permissions";
import { getOrCreateReconciliationPeriod } from "@/lib/reconciliation-status";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const validBalance = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e13 && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;

/**
 * Saves (or clears) the two closing balances for a period: the one printed on the bank statement and
 * the one in the books. They are saved together, since the reconciliation needs both.
 */
export async function saveStatementBalances(input: {
  accountId: string;
  month: string;
  statementClosing: number | null;
  bookClosing: number | null;
}): Promise<{ error?: string }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  assertPermission(membership.role, "reconciliation.match");

  if (!MONTH_RE.test(input.month)) return { error: "Invalid month." };
  const clearing = input.statementClosing === null && input.bookClosing === null;
  if (!clearing) {
    if (input.statementClosing === null || input.bookClosing === null) return { error: "Enter both balances, or clear both." };
    if (!validBalance(input.statementClosing) || !validBalance(input.bookClosing)) {
      return { error: "Balances must be numbers with at most two decimal places." };
    }
  }

  const supabase = (await createClient()) as any;
  const { data: account } = await supabase
    .from("accounts")
    .select("id, entity_id, name, is_reconcilable, archived_at")
    .eq("id", input.accountId)
    .maybeSingle();
  if (!account) return { error: "Account not found." };
  if (account.archived_at || !account.is_reconcilable) return { error: "This account isn't being reconciled." };

  const reconciliationId = await getOrCreateReconciliationPeriod(account.entity_id, input.accountId, `${input.month}-15T12:00:00.000Z`, membership.userId);
  const { data: before } = await supabase
    .from("reconciliations")
    .select("status, statement_closing_balance, book_closing_balance")
    .eq("id", reconciliationId)
    .single();
  if (before?.status === "finalized") return { error: "This period is finalized. Reopen it before changing the balances." };

  const { error } = await supabase
    .from("reconciliations")
    .update({
      statement_closing_balance: input.statementClosing,
      book_closing_balance: input.bookClosing,
      balances_entered_by: clearing ? null : membership.userId,
      balances_entered_at: clearing ? null : new Date().toISOString(),
    })
    .eq("id", reconciliationId);
  if (error) return { error: error.message };

  await supabase.from("audit_log").insert({
    organization_id: membership.organizationId,
    entity_id: account.entity_id,
    actor_id: membership.userId,
    action: clearing ? "reconciliation.balances_cleared" : "reconciliation.balances_saved",
    target_table: "reconciliations",
    target_id: reconciliationId,
    before: { statement: before?.statement_closing_balance ?? null, books: before?.book_closing_balance ?? null },
    after: { statement: input.statementClosing, books: input.bookClosing, month: input.month },
  });

  revalidatePath(`/reconciliation/${input.accountId}`);
  revalidatePath("/reports", "layout");
  return {};
}
