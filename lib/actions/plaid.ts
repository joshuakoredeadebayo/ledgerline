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

  revalidatePath("/entities");
  revalidatePath("/reconciliation");
  return { success: true };
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