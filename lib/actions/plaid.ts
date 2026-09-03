"use server";

import { revalidatePath } from "next/cache";
import { CountryCode, Products } from "plaid";
import { plaidClient } from "@/lib/plaid/client";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { assertPermission } from "@/lib/permissions";

export type PlaidActionState =
  | {
      error?: string;
      success?: boolean;
      needsEntityAssignment?: boolean;
      pendingAccounts?: PendingAccount[];
      plaidItemId?: string;
    }
  | null;

export type PendingAccount = {
  plaidAccountId: string;
  name: string;
  accountType: "asset" | "liability" | "equity" | "revenue" | "expense";
  mask: string | null;
};

// Maps Plaid's account type/subtype vocabulary onto Ledgerline's five
// chart-of-accounts buckets, so the existing code-generation logic
// (asset 1000s, liability 2000s, etc.) works unmodified for imported
// accounts.
function mapPlaidTypeToAccountType(plaidType: string): PendingAccount["accountType"] {
  switch (plaidType) {
    case "depository":
    case "investment":
      return "asset";
    case "credit":
    case "loan":
      return "liability";
    default:
      return "asset";
  }
}

/**
 * Starts a Plaid Link session. Called from the client when the person
 * clicks "Connect bank" — the returned link_token is handed to Plaid's
 * Link widget, which drives the actual bank-login UI.
 *
 * No redirect_uri is set here: per Plaid's docs, web integrations
 * (as opposed to native iOS/Android SDKs) handle OAuth institutions
 * via an automatic popup window and don't require one. Passing an
 * unregistered redirect_uri would cause linkTokenCreate to fail for
 * every institution, not just OAuth ones.
 */
export async function createLinkToken(): Promise<{ linkToken?: string; error?: string }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };

  assertPermission(membership.role, "entities.manage");

  try {
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: membership.userId },
      client_name: "Ledgerline",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: "en",
    });
    return { linkToken: response.data.link_token };
  } catch (err: any) {
    return { error: err?.message ?? "Could not start the bank connection." };
  }
}

/**
 * Exchanges Plaid Link's temporary public token for a permanent access
 * token, stores the connection, then imports the accounts it exposes.
 * If the organization has exactly one entity, accounts are created
 * automatically. Otherwise this returns the pending account list so
 * the person can assign each one to an entity before anything is
 * written to `accounts`.
 */
export async function exchangePublicToken(publicToken: string, presetEntityId?: string): Promise<PlaidActionState> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };

  assertPermission(membership.role, "entities.manage");

  const supabase = await createClient();

  let accessToken: string;
  let itemId: string;
  let institutionName: string | null = null;

  try {
    const exchangeResponse = await plaidClient.itemPublicTokenExchange({ public_token: publicToken });
    accessToken = exchangeResponse.data.access_token;
    itemId = exchangeResponse.data.item_id;

    const itemResponse = await plaidClient.itemGet({ access_token: accessToken });
    const institutionId = itemResponse.data.item.institution_id;
    if (institutionId) {
      const instResponse = await plaidClient.institutionsGetById({
        institution_id: institutionId,
        country_codes: [CountryCode.Us],
      });
      institutionName = instResponse.data.institution.name;
    }
  } catch (err: any) {
    return { error: err?.message ?? "Could not connect to your bank." };
  }

  const { data: plaidItem, error: itemError } = await supabase
    .from("plaid_items")
    .insert({
      organization_id: membership.organizationId,
      item_id: itemId,
      access_token: accessToken,
      institution_name: institutionName,
      created_by: membership.userId,
    })
    .select("id")
    .single();

  if (itemError || !plaidItem) {
    return { error: itemError?.message ?? "Could not save the bank connection." };
  }

  let plaidAccounts;
  try {
    const accountsResponse = await plaidClient.accountsGet({ access_token: accessToken });
    plaidAccounts = accountsResponse.data.accounts;
  } catch (err: any) {
    return { error: err?.message ?? "Connected, but couldn't retrieve accounts. Try refreshing." };
  }

  const pendingAccounts: PendingAccount[] = plaidAccounts.map((a) => ({
    plaidAccountId: a.account_id,
    name: a.name,
    accountType: mapPlaidTypeToAccountType(a.type),
    mask: a.mask ?? null,
  }));

  // If the connection was started from a specific entity's own page,
  // that's a deliberate choice — assign everything there directly,
  // regardless of how many entities the organization has overall.
  if (presetEntityId) {
    const result = await createAccountsForEntity(presetEntityId, plaidItem.id, pendingAccounts);
    if (result.error) return { error: result.error };
    // Best-effort: accounts already exist, so a sync hiccup here
    // shouldn't undo a successful connection. Errors are captured in
    // sync_jobs for later inspection rather than surfaced here.
    await syncPlaidItem(plaidItem.id).catch(() => {});
    revalidatePath(`/entities/${presetEntityId}`);
    revalidatePath("/reconciliation");
    return { success: true };
  }

  const { data: entities } = await supabase
    .from("entities")
    .select("id")
    .eq("organization_id", membership.organizationId);

  const entityList = entities ?? [];
  if (entityList.length === 1) {
    const entity = entityList[0];
    if (!entity) {
      return { error: "Unexpected error resolving entity." };
    }
    const result = await createAccountsForEntity(entity.id, plaidItem.id, pendingAccounts);
    if (result.error) return { error: result.error };
    await syncPlaidItem(plaidItem.id).catch(() => {});
    revalidatePath("/entities");
    revalidatePath("/reconciliation");
    return { success: true };
  }

  // Multiple entities — hand back to the client for a picker rather
  // than guessing which entity each account belongs to.
  return { needsEntityAssignment: true, pendingAccounts, plaidItemId: plaidItem.id };
}

/**
 * Creates one Ledgerline account per pending Plaid account, all under
 * the same entity. Reuses the same code-generation approach as manual
 * account creation, with the same retry-on-collision safety net.
 */
async function createAccountsForEntity(
  entityId: string,
  plaidItemId: string,
  accounts: PendingAccount[]
): Promise<{ error?: string }> {
  const supabase = await createClient();

  for (const account of accounts) {
    const MAX_ATTEMPTS = 3;
    let lastError: string | null = null;
    let created = false;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const code = await generateNextAccountCode(supabase, entityId, account.accountType);

      const { error } = await supabase.from("accounts").insert({
        entity_id: entityId,
        name: account.name,
        account_type: account.accountType,
        code,
        is_reconcilable: true,
        source: "plaid",
        plaid_account_id: account.plaidAccountId,
        plaid_item_id: plaidItemId,
      });

      if (!error) {
        created = true;
        break;
      }
      // Duplicate plaid_account_id for this entity — already imported,
      // not a real failure. Skip it rather than erroring the whole batch.
      if (error.code === "23505" && error.message.includes("plaid_account")) {
        created = true;
        break;
      }
      if (error.code !== "23505") {
        return { error: error.message };
      }
      lastError = error.message;
    }

    if (!created) {
      return { error: lastError ?? `Could not create account "${account.name}" after multiple attempts.` };
    }
  }

  return {};
}

/**
 * Called from the entity-assignment picker once the person has chosen
 * which entity each pending account belongs to.
 */
export async function assignPlaidAccountsToEntities(
  assignments: { plaidAccountId: string; entityId: string; name: string; accountType: PendingAccount["accountType"] }[],
  plaidItemId: string
): Promise<PlaidActionState> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };

  assertPermission(membership.role, "entities.manage");

  const byEntity = new Map<string, PendingAccount[]>();
  for (const a of assignments) {
    const list = byEntity.get(a.entityId) ?? [];
    list.push({ plaidAccountId: a.plaidAccountId, name: a.name, accountType: a.accountType, mask: null });
    byEntity.set(a.entityId, list);
  }

  for (const [entityId, accounts] of byEntity.entries()) {
    const result = await createAccountsForEntity(entityId, plaidItemId, accounts);
    if (result.error) return { error: result.error };
  }

  await syncPlaidItem(plaidItemId).catch(() => {});

  revalidatePath("/entities");
  revalidatePath("/reconciliation");
  return { success: true };
}

/**
 * Pulls transactions for a Plaid Item using the cursor-based sync
 * endpoint, upserts them into `transactions`, and advances the item's
 * stored cursor so the next call only fetches what's changed since.
 *
 * Called automatically right after a bank connection completes, and
 * exposed for a manual "Sync now" trigger via syncEntityPlaidItems
 * below. Every run is logged in sync_jobs for visibility into
 * failures, since this can be triggered without a person watching.
 */
export async function syncPlaidItem(plaidItemId: string): Promise<{ error?: string; syncedCount?: number }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };

  assertPermission(membership.role, "entities.manage");

  const supabase = await createClient();

  const { data: item, error: itemFetchError } = await supabase
    .from("plaid_items")
    .select("id, organization_id, access_token, cursor")
    .eq("id", plaidItemId)
    .single();

  if (itemFetchError || !item) {
    return { error: itemFetchError?.message ?? "Bank connection not found." };
  }
  if (item.organization_id !== membership.organizationId) {
    return { error: "Not authorized for this bank connection." };
  }

  const { data: jobRow } = await supabase
    .from("sync_jobs")
    .insert({ job_type: "plaid_sync", plaid_item_id: plaidItemId, status: "running", started_at: new Date().toISOString() })
    .select("id")
    .single();

  // Maps Plaid's account_id to this item's Ledgerline account row, so
  // each transaction lands under the right entity_id/account_id. Only
  // accounts already imported into Ledgerline are mapped — a new
  // account opened at the bank after the initial connect won't have
  // transactions synced until it's imported too (a known limitation,
  // not handled by this pass).
  const { data: accountRows } = await supabase
    .from("accounts")
    .select("id, entity_id, plaid_account_id")
    .eq("plaid_item_id", plaidItemId);

  const accountMap = new Map((accountRows ?? []).map((a) => [a.plaid_account_id, { id: a.id, entityId: a.entity_id }]));
  const knownEntityIds = [...new Set((accountRows ?? []).map((a) => a.entity_id))];

  let cursor = item.cursor ?? undefined;
  let syncedCount = 0;

  try {
    let hasMore = true;
    while (hasMore) {
      const response = await plaidClient.transactionsSync({
        access_token: item.access_token,
        cursor,
      });
      const { added, modified, removed, next_cursor, has_more } = response.data;

      const upsertRows = [...added, ...modified]
        .map((txn) => {
          const mapped = accountMap.get(txn.account_id);
          if (!mapped) return null; // Account not yet imported — skip for now.
          return {
            entity_id: mapped.entityId,
            account_id: mapped.id,
            source: "plaid",
            // Plaid's sign convention: positive = money leaving the
            // account, negative = money coming in. Stored as-is —
            // worth confirming this matches the matching engine's
            // expected sign during testing, since that logic lives
            // elsewhere and wasn't reviewed as part of this change.
            amount: txn.amount,
            currency: txn.iso_currency_code ?? txn.unofficial_currency_code ?? "USD",
            transaction_date: txn.date,
            description: txn.merchant_name ?? txn.name ?? null,
            raw_payload: txn,
            plaid_transaction_id: txn.transaction_id,
            is_pending: txn.pending,
            // status deliberately omitted: leaving it out of the
            // upsert means Postgres only applies the column default
            // on first insert, and leaves an already-set status
            // (e.g. a confirmed match) untouched on every later
            // re-sync of the same transaction.
          };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null);

      if (upsertRows.length > 0) {
        const { error: upsertError } = await supabase
          .from("transactions")
          .upsert(upsertRows, { onConflict: "entity_id,plaid_transaction_id" });
        if (upsertError) throw new Error(upsertError.message);
        syncedCount += upsertRows.length;
      }

      if (removed.length > 0 && knownEntityIds.length > 0) {
        const removedIds = removed.map((r) => r.transaction_id);
        // Soft-delete only: a hard delete would cascade and silently
        // remove any match_lines already built against these rows.
        const { error: removeError } = await supabase
          .from("transactions")
          .update({ status: "removed" })
          .in("entity_id", knownEntityIds)
          .in("plaid_transaction_id", removedIds);
        if (removeError) throw new Error(removeError.message);
      }

      cursor = next_cursor;
      hasMore = has_more;
    }

    await supabase
      .from("plaid_items")
      .update({ cursor, last_synced_at: new Date().toISOString() })
      .eq("id", plaidItemId);

    if (jobRow) {
      await supabase
        .from("sync_jobs")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", jobRow.id);
    }

    revalidatePath("/reconciliation");
    return { syncedCount };
  } catch (err: any) {
    const message = err?.message ?? "Sync failed unexpectedly.";
    if (jobRow) {
      await supabase
        .from("sync_jobs")
        .update({ status: "failed", error: message, completed_at: new Date().toISOString() })
        .eq("id", jobRow.id);
    }
    return { error: message };
  }
}

/**
 * Manual "Sync now" entry point, scoped to one entity rather than one
 * Plaid Item — a person on an entity's page doesn't necessarily know
 * which bank connection(s) fund it, so this finds every distinct
 * Plaid Item behind that entity's accounts and syncs each in turn.
 */
export async function syncEntityPlaidItems(entityId: string): Promise<{ error?: string; syncedCount?: number }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };

  const supabase = await createClient();

  const { data: accountRows } = await supabase
    .from("accounts")
    .select("plaid_item_id")
    .eq("entity_id", entityId)
    .not("plaid_item_id", "is", null);

  const itemIds = [...new Set((accountRows ?? []).map((a) => a.plaid_item_id).filter(Boolean))] as string[];

  if (itemIds.length === 0) {
    return { error: "No connected bank accounts for this entity." };
  }

  let total = 0;
  for (const itemId of itemIds) {
    const result = await syncPlaidItem(itemId);
    if (result.error) return { error: result.error };
    total += result.syncedCount ?? 0;
  }

  revalidatePath(`/entities/${entityId}`);
  revalidatePath("/reconciliation");
  return { syncedCount: total };
}

// Duplicated from lib/actions/entities.ts deliberately kept in sync,
// not imported, because that file's version is scoped as a private
// (non-exported) helper. If you'd rather share one implementation,
// export generateNextAccountCode from entities.ts and import it here
// instead — flagging this as a follow-up rather than doing a
// cross-file refactor inside this slice.
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