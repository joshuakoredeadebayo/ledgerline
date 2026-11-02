"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { assertPermission } from "@/lib/permissions";
import {
  createQuickBooksRecord,
  revokeQuickBooksToken,
  getValidAccessToken,
  queryQuickBooks,
  mapQuickBooksAccountType,
  type QuickBooksItemRow,
} from "@/lib/quickbooks/client";
import { getOrCreateReconciliationPeriod, recomputeReconciliationStatus } from "@/lib/reconciliation-status";
import { mapBillPayment, mapJournalEntry, mapPayment, mapTransfer, type LedgerRow } from "@/lib/quickbooks/transactions";
import { buildQuickBooksJournalEntry, isLedgerlineEntry, quickBooksAccountType, quickBooksErrorMessage } from "@/lib/quickbooks/journal-payload";

export interface QuickBooksConnection {
  id: string;
  companyName: string | null;
  realmId: string;
  status: string;
  createdAt: string;
  lastSyncedAt: string | null;
  /** The entity this connection belongs to, or null for a shared, organization-wide connection. */
  entityId: string | null;
}

/** Every QuickBooks connection in the organization (one per linked company). */
export async function listQuickBooksConnections(): Promise<QuickBooksConnection[]> {
  const membership = await getCurrentMembership();
  if (!membership) return [];

  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("quickbooks_items")
    .select("id, company_name, realm_id, status, created_at, last_synced_at, entity_id")
    .eq("organization_id", membership.organizationId)
    .order("created_at", { ascending: true });

  return ((data ?? []) as any[]).map((row) => ({
    id: row.id,
    companyName: row.company_name,
    realmId: row.realm_id,
    status: row.status,
    createdAt: row.created_at,
    lastSyncedAt: row.last_synced_at,
    entityId: row.entity_id,
  }));
}

/**
 * Finds the QuickBooks connection an entity should use, in this order:
 *   1. a connection made specifically for this entity;
 *   2. the connection its already-imported QuickBooks accounts came from (so an entity
 *      never loses access to accounts it has, even if connections are rearranged);
 *   3. a shared, organization-wide connection (the original single-connection setup).
 * Everything that talks to QuickBooks goes through this one function, so the choice of
 * connection lives in exactly one place.
 */
async function getConnectionForEntity(organizationId: string, entityId: string): Promise<QuickBooksItemRow | null> {
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("quickbooks_items")
    .select("id, realm_id, access_token, refresh_token, access_token_expires_at, entity_id")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });
  const items = (data ?? []) as (QuickBooksItemRow & { entity_id: string | null })[];
  if (items.length === 0) return null;

  const own = items.find((i) => i.entity_id === entityId);
  if (own) return own;

  const { data: bound } = await supabase
    .from("accounts")
    .select("quickbooks_item_id")
    .eq("entity_id", entityId)
    .not("quickbooks_item_id", "is", null)
    .limit(1);
  const boundId = bound?.[0]?.quickbooks_item_id as string | undefined;
  if (boundId) {
    const viaAccounts = items.find((i) => i.id === boundId);
    if (viaAccounts) return viaAccounts;
  }

  return items.find((i) => i.entity_id === null) ?? null;
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

  const item = await getConnectionForEntity(membership.organizationId, entityId);
  if (!item) return { error: "This entity isn't connected to QuickBooks yet. Use “Connect QuickBooks” on this page first." };

  const supabase = await createClient();

  // QuickBooks account ids are only unique within one company. An entity can't mix accounts
  // from two companies, or ids from different books would collide.
  const { data: otherCompany } = await (supabase as any)
    .from("accounts")
    .select("id")
    .eq("entity_id", entityId)
    .not("quickbooks_item_id", "is", null)
    .neq("quickbooks_item_id", item.id)
    .limit(1);
  if (otherCompany && otherCompany.length > 0) {
    return { error: "This entity already has accounts from a different QuickBooks company, so it can't import from this one." };
  }

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
      .select("id, plaid_account_id, user_edited")
      .eq("entity_id", entityId)
      .eq("quickbooks_account_id", qbAccount.Id)
      .maybeSingle();

    if (existingAccount) {
      if (existingAccount.plaid_account_id || existingAccount.user_edited) {
        // Also skipped when a person has edited this account by hand
        // (Entities → Edit): their name/type/reconciliation choices win
        // over whatever QuickBooks currently says.
        // This account has been merged with a Plaid account via "Link
        // accounts" — its name/type are now user-decided, not just a
        // mirror of QuickBooks. Overwriting them here on every re-import
        // would silently undo that linking work. Still counts as
        // "imported" since the account itself is correctly in sync.
        importedCount++;
        continue;
      }
      // Re-importing an already-linked (but not merged) account —
      // refresh name/type/reconcilable flag to stay in sync with
      // QuickBooks, but never touch `code`, since that's meant to be a
      // stable reference once assigned.
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
    revalidatePath("/dashboard");
  return { importedCount };
}

/**
 * Pulls ledger activity from QuickBooks since the connection's last sync and upserts it
 * into `transactions`. Covers Purchases and Deposits plus the types that move money
 * through a bank or card account without being either: Transfers, Bill Payments,
 * customer Payments and Journal Entries (one row per bank/card line).
 *
 * Pass { fullResync: true } to ignore the last-sync time and re-pull the last 90 days.
 * Safe to repeat: every row has a stable key, so existing rows are updated, not duplicated.
 * Use it once after upgrading, to bring in older activity of the newly supported types.
 *
 * Invoices and Bills aren't synced: they record what is owed, not money moving through
 * an account, so there is no bank line to match them against.
 */
export async function syncQuickBooksTransactions(
  entityId: string,
  options: { fullResync?: boolean } = {}
): Promise<{
  error?: string;
  syncedCount?: number;
  fetchedFromQuickBooks?: number;
  unmatchedAccountIds?: string[];
  /** Per transaction type: how many QuickBooks returned, and how many were saved to Ledgerline. */
  breakdown?: { type: string; fetched: number; saved: number }[];
  /** Rows QuickBooks returned for an imported account that isn't switched on for reconciliation. */
  skippedNotReconcilable?: number;
}> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };

  assertPermission(membership.role, "entities.manage");

  const item = await getConnectionForEntity(membership.organizationId, entityId);
  if (!item) return { error: "This entity isn't connected to QuickBooks yet. Use “Connect QuickBooks” on this page first." };

  const supabase = (await createClient()) as any;

  const { data: fullItem } = await supabase.from("quickbooks_items").select("last_synced_at").eq("id", item.id).single();

  // First sync pulls the last 90 days rather than all-time history —
  // matches the general shape of Plaid's sandbox default window, and
  // avoids an unbounded first pull on a company with years of data.
  const since =
    fullItem?.last_synced_at && !options.fullResync
      ? new Date(fullItem.last_synced_at)
      : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const sinceIso = since.toISOString();

  const { data: accountRows } = await supabase
    .from("accounts")
    .select("id, entity_id, quickbooks_account_id, is_reconcilable")
    .eq("quickbooks_item_id", item.id);
  const accountMap = new Map<string, { id: string; entityId: string; reconcilable: boolean }>(
    ((accountRows ?? []) as any[]).map((a) => [a.quickbooks_account_id, { id: a.id, entityId: a.entity_id, reconcilable: !!a.is_reconcilable }])
  );

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
  let skippedNotReconcilable = 0;
  const savedByType = new Map<string, number>();

  const queryType = (type: string) =>
    queryQuickBooks(item.realm_id, accessToken, `SELECT * FROM ${type} WHERE Metadata.LastUpdatedTime > '${sinceIso}' MAXRESULTS 1000`);

  try {
    const [purchases, deposits, transfers, billPayments, payments, journalEntries] = await Promise.all([
      queryType("Purchase"),
      queryType("Deposit"),
      queryType("Transfer"),
      queryType("BillPayment"),
      queryType("Payment"),
      queryType("JournalEntry"),
    ]);
    fetchedFromQuickBooks =
      purchases.length + deposits.length + transfers.length + billPayments.length + payments.length + journalEntries.length;

    const upsertRows: any[] = [];

    const addRow = (type: string, row: Omit<LedgerRow, "qbAccountId">, mapped: { id: string; entityId: string }) => {
      savedByType.set(type, (savedByType.get(type) ?? 0) + 1);
      affectedAccounts.set(mapped.id, { entityId: mapped.entityId });
      upsertRows.push({
        entity_id: mapped.entityId,
        account_id: mapped.id,
        source: "quickbooks",
        amount: row.amount,
        currency: row.currency,
        transaction_date: row.date,
        description: row.description,
        raw_payload: row.raw,
        quickbooks_transaction_id: row.key,
      });
    };

    for (const purchase of purchases) {
      const qbAccountId = purchase.AccountRef?.value;
      const mapped = qbAccountId ? accountMap.get(qbAccountId) : undefined;
      if (!mapped) {
        if (qbAccountId) unmatchedAccountIds.add(qbAccountId);
        continue;
      }
      addRow(
        "Purchases",
        {
          // Positive = money leaving the account — matches Plaid's convention (QuickBooks'
          // TotalAmt is always unsigned, so direction is applied here based on transaction type).
          amount: purchase.TotalAmt,
          currency: purchase.CurrencyRef?.value ?? "USD",
          date: purchase.TxnDate,
          description: purchase.PrivateNote || purchase.EntityRef?.name || "QuickBooks Purchase",
          key: `purchase-${purchase.Id}`,
          raw: purchase,
        },
        mapped
      );
    }

    for (const deposit of deposits) {
      const qbAccountId = deposit.DepositToAccountRef?.value;
      const mapped = qbAccountId ? accountMap.get(qbAccountId) : undefined;
      if (!mapped) {
        if (qbAccountId) unmatchedAccountIds.add(qbAccountId);
        continue;
      }
      addRow(
        "Deposits",
        {
          amount: -deposit.TotalAmt, // negative = money coming in
          currency: deposit.CurrencyRef?.value ?? "USD",
          date: deposit.TxnDate,
          description: deposit.PrivateNote || "QuickBooks Deposit",
          key: `deposit-${deposit.Id}`,
          raw: deposit,
        },
        mapped
      );
    }

    // The newer types only land on accounts that are actually reconciled against a feed
    // (bank and card accounts), so a journal line to an expense account, or a payment
    // parked in Undeposited Funds, doesn't create noise.
    const extraTypes: { type: string; rows: LedgerRow[]; reportMissing: boolean }[] = [
      { type: "Transfers", rows: transfers.flatMap(mapTransfer), reportMissing: true },
      { type: "Bill payments", rows: billPayments.flatMap(mapBillPayment), reportMissing: true },
      { type: "Customer payments", rows: payments.flatMap(mapPayment), reportMissing: true },
      // Most journal lines hit income, expense or equity accounts we never import, so a
      // missing account here is normal and isn't reported as a problem.
      { type: "Journal entries", rows: journalEntries.filter((j: any) => !isLedgerlineEntry(j.PrivateNote)).flatMap(mapJournalEntry), reportMissing: false },
    ];
    for (const { type, rows, reportMissing } of extraTypes) {
      for (const row of rows) {
        const mapped = accountMap.get(row.qbAccountId);
        if (!mapped) {
          if (reportMissing) unmatchedAccountIds.add(row.qbAccountId);
          continue;
        }
        if (!mapped.reconcilable) {
          skippedNotReconcilable++;
          continue;
        }
        addRow(type, row, mapped);
      }
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
    revalidatePath("/dashboard");
    const fetchedByType: [string, number][] = [
      ["Purchases", purchases.length],
      ["Deposits", deposits.length],
      ["Transfers", transfers.length],
      ["Bill payments", billPayments.length],
      ["Customer payments", payments.length],
      ["Journal entries", journalEntries.length],
    ];
    return {
      syncedCount,
      fetchedFromQuickBooks,
      unmatchedAccountIds: [...unmatchedAccountIds],
      breakdown: fetchedByType.map(([type, fetched]) => ({ type, fetched, saved: savedByType.get(type) ?? 0 })),
      skippedNotReconcilable,
    };
  } catch (err: any) {
    return { error: err?.message ?? "QuickBooks sync failed unexpectedly." };
  }
}

/** Disconnects one QuickBooks company. Accounts and transactions already imported stay in Ledgerline. */
export async function disconnectQuickBooks(connectionId: string): Promise<{ error?: string }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };

  assertPermission(membership.role, "org.manage_integrations");

  const supabase = (await createClient()) as any;
  const { data: item } = await supabase
    .from("quickbooks_items")
    .select("id, access_token, company_name, entity_id")
    .eq("id", connectionId)
    .eq("organization_id", membership.organizationId)
    .maybeSingle();

  if (!item) return { error: "QuickBooks connection not found." };

  // Best-effort: also tell Intuit to revoke the token, so this app
  // stops showing as connected on QuickBooks' side too. If this call
  // fails, we still remove our own record — a stale, unusable token
  // sitting in Intuit's system causes no harm, but leaving our row
  // behind claiming an active connection would be misleading.
  await revokeQuickBooksToken(item.access_token).catch(() => {});

  const { error } = await supabase.from("quickbooks_items").delete().eq("id", item.id);
  if (error) return { error: error.message };

  await supabase.from("audit_log").insert({
    organization_id: membership.organizationId,
    actor_id: membership.userId,
    action: "quickbooks.disconnected",
    target_table: "quickbooks_items",
    target_id: item.id,
    before: { company: item.company_name, entity_id: item.entity_id },
    after: null,
  });

  revalidatePath("/settings/integrations");
  revalidatePath("/entities", "layout");
  return {};
}


// ────────────────────────────────────────────────────────────────
// Sending journal entries to QuickBooks
// ────────────────────────────────────────────────────────────────

/** Finds the QuickBooks account with this name, or creates it, and records the link on the Ledgerline account. */
async function ensureQuickBooksAccount(
  supabase: any,
  item: QuickBooksItemRow,
  accessToken: string,
  account: { id: string; name: string; account_type: string; is_reconcilable: boolean }
): Promise<{ qbId?: string; error?: string }> {
  const safeName = account.name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const found = await queryQuickBooks(item.realm_id, accessToken, `SELECT * FROM Account WHERE Name = '${safeName}'`).catch(() => []);
  let qbId: string | undefined = found[0]?.Id;

  if (!qbId) {
    const created = await createQuickBooksRecord<{ Id: string }>(item.realm_id, accessToken, "account", {
      Name: account.name,
      ...quickBooksAccountType(account.account_type, account.is_reconcilable),
    });
    if (!created.ok) return { error: `QuickBooks wouldn't create the account "${account.name}": ${quickBooksErrorMessage(created.text)}` };
    qbId = created.record.Id;
  }

  const { error } = await supabase.from("accounts").update({ quickbooks_account_id: qbId, quickbooks_item_id: item.id }).eq("id", account.id);
  if (error) {
    return {
      error:
        error.code === "23505"
          ? `An account imported from QuickBooks already uses "${account.name}". Link the two under Entities, then send the entry again.`
          : error.message,
    };
  }
  return { qbId };
}

/**
 * Sends a posted journal entry to QuickBooks so the books there match. The entry carries a marker in its
 * note so Ledgerline recognises it on the next sync and doesn't bring it back as a duplicate. Safe to
 * retry: each entry is sent with its own request id, so QuickBooks never records it twice.
 *
 * Every account on the entry must exist in QuickBooks. If some don't, nothing is sent and the missing
 * ones are returned; sending again with createMissingAccounts creates them there first.
 */
export async function pushJournalEntryToQuickBooks(
  entryId: string,
  options: { createMissingAccounts?: boolean } = {}
): Promise<{ error?: string; qbId?: string; missingAccounts?: string[] }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  assertPermission(membership.role, "journal_entries.post");

  const supabase = (await createClient()) as any;
  const { data: entry } = await supabase
    .from("journal_entries")
    .select(
      "id, entity_id, entry_date, description, status, qb_journal_entry_id, journal_entry_lines(id, debit, credit, memo, account_id, accounts(id, name, account_type, is_reconcilable, quickbooks_account_id, quickbooks_item_id))"
    )
    .eq("id", entryId)
    .maybeSingle();
  if (!entry) return { error: "Journal entry not found." };
  if (entry.status === "draft") return { error: "Post the entry before sending it to QuickBooks." };
  if (entry.qb_journal_entry_id) return { qbId: entry.qb_journal_entry_id };

  const item = await getConnectionForEntity(membership.organizationId, entry.entity_id);
  if (!item) return { error: "This entity isn't connected to QuickBooks. Connect it under Settings, then Integrations." };

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(item, supabase);
  } catch (err: any) {
    return { error: err?.message ?? "Could not reach QuickBooks." };
  }

  const lines: any[] = entry.journal_entry_lines ?? [];
  const accounts = new Map<string, any>();
  for (const l of lines) if (l.accounts) accounts.set(l.accounts.id, l.accounts);

  // An account that belongs to a different QuickBooks company can't be used here.
  for (const a of accounts.values()) {
    if (a.quickbooks_account_id && a.quickbooks_item_id && a.quickbooks_item_id !== item.id) {
      return { error: `The account "${a.name}" belongs to a different QuickBooks company than this entity uses.` };
    }
  }

  const unmapped = [...accounts.values()].filter((a) => !a.quickbooks_account_id);
  if (unmapped.length > 0 && !options.createMissingAccounts) {
    return { error: "Some accounts aren't in QuickBooks yet.", missingAccounts: unmapped.map((a) => a.name) };
  }
  for (const a of unmapped) {
    const ensured = await ensureQuickBooksAccount(supabase, item, accessToken, a);
    if (ensured.error) return { error: ensured.error };
    a.quickbooks_account_id = ensured.qbId;
  }

  const built = buildQuickBooksJournalEntry({
    entryId: entry.id,
    entryDate: entry.entry_date,
    description: entry.description,
    lines: lines.map((l) => ({
      qbAccountId: accounts.get(l.account_id)?.quickbooks_account_id,
      debit: Number(l.debit),
      credit: Number(l.credit),
      memo: l.memo,
    })),
  });
  if ("error" in built) return { error: built.error };

  const sent = await createQuickBooksRecord<{ Id: string }>(item.realm_id, accessToken, "journalentry", built.body, entry.id);
  if (!sent.ok) {
    const message = quickBooksErrorMessage(sent.text);
    await supabase.from("journal_entries").update({ qb_error: message }).eq("id", entryId);
    await supabase.from("audit_log").insert({
      organization_id: membership.organizationId,
      entity_id: entry.entity_id,
      actor_id: membership.userId,
      action: "journal_entry.quickbooks_failed",
      target_table: "journal_entries",
      target_id: entryId,
      after: { error: message },
    });
    revalidatePath(`/journal-entries/${entryId}`);
    return { error: `QuickBooks refused the entry: ${message}` };
  }

  await supabase
    .from("journal_entries")
    .update({ qb_journal_entry_id: sent.record.Id, qb_synced_at: new Date().toISOString(), qb_error: null })
    .eq("id", entryId);
  await supabase.from("audit_log").insert({
    organization_id: membership.organizationId,
    entity_id: entry.entity_id,
    actor_id: membership.userId,
    action: "journal_entry.sent_to_quickbooks",
    target_table: "journal_entries",
    target_id: entryId,
    after: { quickbooks_id: sent.record.Id },
  });
  revalidatePath(`/journal-entries/${entryId}`);
  revalidatePath("/journal-entries");
  return { qbId: sent.record.Id };
}
