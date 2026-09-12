"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { assertPermission } from "@/lib/permissions";
import {
  revokeQuickBooksToken,
  getValidAccessToken,
  queryQuickBooks,
  mapQuickBooksAccountType,
  type QuickBooksItemRow,
} from "@/lib/quickbooks/client";
import { getOrCreateReconciliationPeriod, recomputeReconciliationStatus } from "@/lib/reconciliation-status";

export interface QuickBooksConnection {
  id: string;
  companyName: string | null;
  realmId: string;
  status: string;
  createdAt: string;
}

export async function getQuickBooksConnection(): Promise<QuickBooksConnection | null> {
  const membership = await getCurrentMembership();
  if (!membership) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("quickbooks_items")
    .select("id, company_name, realm_id, status, created_at")
    .eq("organization_id", membership.organizationId)
    .maybeSingle();

  if (!data) return null;

  return {
    id: data.id,
    companyName: data.company_name,
    realmId: data.realm_id,
    status: data.status,
    createdAt: data.created_at,
  };
}

// Internal helper — fetches the full connection row (tokens included)
// for the org's single QuickBooks connection. Ledgerline's design
// deliberately treats one QuickBooks connection per org as covering
// potentially several entities, the same way Plaid Items work — so
// this stays a single lookup rather than a list.
async function getConnectionForOrg(organizationId: string): Promise<QuickBooksItemRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("quickbooks_items")
    .select("id, realm_id, access_token, refresh_token, access_token_expires_at")
    .eq("organization_id", organizationId)
    .maybeSingle();
  return data as QuickBooksItemRow | null;
}

// Duplicated from lib/actions/entities.ts (and lib/actions/plaid.ts,
// which duplicated it first) rather than shared, for the same reason
// noted there: entities.ts's version is a private, non-exported
// helper. This is now the third copy — worth consolidating into one
// shared export at some point, flagging that rather than doing a
// cross-file refactor inside this feature.
const TYPE_CODE_RANGES: Record<string, number> = {
  asset: 1000,
  liability: 2000,
  equity: 3000,
  revenue: 4000,
  expense: 5000,
};

async function generateNextAccountCode(
  supabase: Awaited<ReturnType<typeof createClient>>,
  entityId: string,
  accountType: string
): Promise<string> {
  const base = TYPE_CODE_RANGES[accountType] ?? 9000;

  const { data: existing } = await supabase
    .from("accounts")
    .select("code")
    .eq("entity_id", entityId)
    .eq("account_type", accountType);

  const codesInRange = (existing ?? [])
    .map((a: any) => parseInt(a.code, 10))
    .filter((n: number) => Number.isFinite(n) && n >= base && n < base + 1000);

  const next = codesInRange.length > 0 ? Math.max(...codesInRange) + 1 : base;
  return String(next);
}

/**
 * Imports the QuickBooks chart of accounts into a specific entity.
 * Only active QB accounts are pulled — archived/inactive ones would
 * just clutter the chart of accounts without being reconcilable
 * against anything current.
 */
export async function importQuickBooksAccounts(entityId: string): Promise<{ error?: string; importedCount?: number }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };

  assertPermission(membership.role, "entities.manage");

  const item = await getConnectionForOrg(membership.organizationId);
  if (!item) return { error: "No QuickBooks connection found. Connect QuickBooks in Settings first." };

  const supabase = await createClient();

  let accessToken: string;
  let qbAccounts: any[];
  try {
    accessToken = await getValidAccessToken(item, supabase);
    // MAXRESULTS 1000 covers virtually every mid-market chart of
    // accounts; a company with more than that would need pagination
    // here, which isn't built yet.
    qbAccounts = await queryQuickBooks(item.realm_id, accessToken, "SELECT * FROM Account WHERE Active = true MAXRESULTS 1000");
  } catch (err: any) {
    return { error: err?.message ?? "Could not reach QuickBooks." };
  }

  let importedCount = 0;

  for (const qbAccount of qbAccounts) {
    const accountType = mapQuickBooksAccountType(qbAccount.AccountType);
    // Only actual bank/card accounts get matched against a real
    // statement — income, expense, COGS, equity, and even AR/AP (which
    // reconcile via aging reports, not bank matching) shouldn't clutter
    // the Reconciliation workspace with accounts that will always sit
    // at "all clear" because nothing ever posts to them from a feed.
    const isReconcilable = qbAccount.AccountType === "Bank" || qbAccount.AccountType === "Credit Card";

    const { data: existingAccount } = await supabase
      .from("accounts")
      .select("id")
      .eq("entity_id", entityId)
      .eq("quickbooks_account_id", qbAccount.Id)
      .maybeSingle();

    if (existingAccount) {
      // Re-importing an already-linked account — refresh name/type/
      // reconcilable flag to stay in sync with QuickBooks, but never
      // touch `code`, since that's meant to be a stable reference once
      // assigned.
      const { error } = await supabase
        .from("accounts")
        .update({ name: qbAccount.Name, account_type: accountType, is_reconcilable: isReconcilable })
        .eq("id", existingAccount.id);
      if (error) return { error: error.message };
      importedCount++;
      continue;
    }

    const MAX_ATTEMPTS = 3;
    let created = false;
    let lastError: string | null = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const code = await generateNextAccountCode(supabase, entityId, accountType);

      const { error } = await supabase.from("accounts").insert({
        entity_id: entityId,
        name: qbAccount.Name,
        account_type: accountType,
        code,
        is_reconcilable: isReconcilable,
        source: "quickbooks",
        quickbooks_account_id: qbAccount.Id,
        quickbooks_item_id: item.id,
      });

      if (!error) {
        created = true;
        importedCount++;
        break;
      }
      // Already imported for this entity — not a real failure, skip it
      // rather than erroring the whole batch, same convention as Plaid.
      if (error.code === "23505" && error.message.includes("quickbooks_account")) {
        created = true;
        break;
      }
      if (error.code !== "23505") {
        return { error: error.message };
      }
      lastError = error.message;
    }

    if (!created) {
      return { error: lastError ?? `Could not create account "${qbAccount.Name}" after multiple attempts.` };
    }
  }

  revalidatePath(`/entities/${entityId}`);
  revalidatePath("/reconciliation");
  return { importedCount };
}

/**
 * Pulls Purchases and Deposits from QuickBooks since the connection's
 * last sync, and upserts them into `transactions`. Scoped to just
 * these two transaction types for now — both map cleanly to one
 * row-per-account-per-amount, unlike Journal Entries (which can touch
 * several accounts in a single entry) or Invoices/Payments/Transfers,
 * which are real QuickBooks activity but need their own handling and
 * are intentionally left for a follow-up rather than built untested
 * alongside everything else here.
 */
export async function syncQuickBooksTransactions(
  entityId: string
): Promise<{ error?: string; syncedCount?: number; fetchedFromQuickBooks?: number; unmatchedAccountIds?: string[] }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };

  assertPermission(membership.role, "entities.manage");

  const item = await getConnectionForOrg(membership.organizationId);
  if (!item) return { error: "No QuickBooks connection found. Connect QuickBooks in Settings first." };

  const supabase = await createClient();

  const { data: fullItem } = await supabase
    .from("quickbooks_items")
    .select("last_synced_at")
    .eq("id", item.id)
    .single();

  // First sync pulls the last 90 days rather than all-time history —
  // matches the general shape of Plaid's sandbox default window, and
  // avoids an unbounded first pull on a company with years of data.
  const since = fullItem?.last_synced_at
    ? new Date(fullItem.last_synced_at)
    : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const sinceIso = since.toISOString();

  const { data: accountRows } = await supabase
    .from("accounts")
    .select("id, entity_id, quickbooks_account_id")
    .eq("quickbooks_item_id", item.id);
  const accountMap = new Map((accountRows ?? []).map((a) => [a.quickbooks_account_id, { id: a.id, entityId: a.entity_id }]));

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(item, supabase);
  } catch (err: any) {
    return { error: err?.message ?? "Could not reach QuickBooks." };
  }

  const affectedAccounts = new Map<string, { entityId: string }>();
  const unmatchedAccountIds = new Set<string>();
  let fetchedFromQuickBooks = 0;
  let syncedCount = 0;

  try {
    const [purchases, deposits] = await Promise.all([
      queryQuickBooks(item.realm_id, accessToken, `SELECT * FROM Purchase WHERE Metadata.LastUpdatedTime > '${sinceIso}' MAXRESULTS 1000`),
      queryQuickBooks(item.realm_id, accessToken, `SELECT * FROM Deposit WHERE Metadata.LastUpdatedTime > '${sinceIso}' MAXRESULTS 1000`),
    ]);
    fetchedFromQuickBooks = purchases.length + deposits.length;

    const upsertRows: any[] = [];

    for (const purchase of purchases) {
      const qbAccountId = purchase.AccountRef?.value;
      const mapped = qbAccountId ? accountMap.get(qbAccountId) : undefined;
      if (!mapped) {
        if (qbAccountId) unmatchedAccountIds.add(qbAccountId);
        continue;
      }
      affectedAccounts.set(mapped.id, { entityId: mapped.entityId });
      upsertRows.push({
        entity_id: mapped.entityId,
        account_id: mapped.id,
        source: "quickbooks",
        // Positive = money leaving the account — matches Plaid's
        // convention (which QuickBooks doesn't natively share; QB's
        // TotalAmt is always unsigned, so direction is applied here
        // based on transaction type).
        amount: purchase.TotalAmt,
        currency: purchase.CurrencyRef?.value ?? "USD",
        transaction_date: purchase.TxnDate,
        description: purchase.PrivateNote || purchase.EntityRef?.name || "QuickBooks Purchase",
        raw_payload: purchase,
        quickbooks_transaction_id: `purchase-${purchase.Id}`,
      });
    }

    for (const deposit of deposits) {
      const qbAccountId = deposit.DepositToAccountRef?.value;
      const mapped = qbAccountId ? accountMap.get(qbAccountId) : undefined;
      if (!mapped) {
        if (qbAccountId) unmatchedAccountIds.add(qbAccountId);
        continue;
      }
      affectedAccounts.set(mapped.id, { entityId: mapped.entityId });
      upsertRows.push({
        entity_id: mapped.entityId,
        account_id: mapped.id,
        source: "quickbooks",
        amount: -deposit.TotalAmt, // negative = money coming in
        currency: deposit.CurrencyRef?.value ?? "USD",
        transaction_date: deposit.TxnDate,
        description: deposit.PrivateNote || "QuickBooks Deposit",
        raw_payload: deposit,
        quickbooks_transaction_id: `deposit-${deposit.Id}`,
      });
    }

    if (upsertRows.length > 0) {
      const { error: upsertError } = await supabase
        .from("transactions")
        .upsert(upsertRows, { onConflict: "entity_id,quickbooks_transaction_id" });
      if (upsertError) throw new Error(upsertError.message);
      syncedCount = upsertRows.length;
    }

    await supabase.from("quickbooks_items").update({ last_synced_at: new Date().toISOString() }).eq("id", item.id);

    for (const [accountId, { entityId: recomputeEntityId }] of affectedAccounts.entries()) {
      try {
        const reconciliationId = await getOrCreateReconciliationPeriod(
          recomputeEntityId,
          accountId,
          new Date().toISOString(),
          membership.userId
        );
        await recomputeReconciliationStatus(reconciliationId);
      } catch (recomputeErr) {
        console.error("Post-sync reconciliation recompute failed:", recomputeErr);
      }
    }

    revalidatePath(`/entities/${entityId}`);
    revalidatePath("/reconciliation");
    return { syncedCount, fetchedFromQuickBooks, unmatchedAccountIds: [...unmatchedAccountIds] };
  } catch (err: any) {
    return { error: err?.message ?? "QuickBooks sync failed unexpectedly." };
  }
}

export async function disconnectQuickBooks(): Promise<{ error?: string }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };

  assertPermission(membership.role, "org.manage_integrations");

  const supabase = await createClient();
  const { data: item } = await supabase
    .from("quickbooks_items")
    .select("id, access_token")
    .eq("organization_id", membership.organizationId)
    .maybeSingle();

  if (!item) return { error: "No QuickBooks connection found." };

  // Best-effort: also tell Intuit to revoke the token, so this app
  // stops showing as connected on QuickBooks' side too. If this call
  // fails, we still remove our own record — a stale, unusable token
  // sitting in Intuit's system causes no harm, but leaving our row
  // behind claiming an active connection would be misleading.
  await revokeQuickBooksToken(item.access_token).catch(() => {});

  const { error } = await supabase.from("quickbooks_items").delete().eq("id", item.id);
  if (error) return { error: error.message };

  revalidatePath("/settings/integrations");
  return {};
}