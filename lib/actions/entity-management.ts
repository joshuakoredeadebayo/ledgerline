"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { plaidClient } from "@/lib/plaid/client";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { assertPermission } from "@/lib/permissions";
import { recomputeReconciliationStatus } from "@/lib/reconciliation-status";

export type ManageState = { error?: string; success?: string } | null;

const ACCOUNT_TYPES = ["asset", "liability", "equity", "revenue", "expense"] as const;

// Same ranges used when accounts are created or imported (see lib/actions/entities.ts).
const TYPE_CODE_RANGES: Record<string, number> = { asset: 1000, liability: 2000, equity: 3000, revenue: 4000, expense: 5000 };

async function logAudit(
  supabase: any,
  organizationId: string,
  actorId: string,
  action: string,
  targetTable: string,
  targetId: string | null,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
) {
  await supabase.from("audit_log").insert({
    organization_id: organizationId,
    actor_id: actorId,
    action,
    target_table: targetTable,
    target_id: targetId,
    before,
    after,
  });
}

function refresh(entityId?: string) {
  revalidatePath("/entities");
  if (entityId) revalidatePath(`/entities/${entityId}`);
  revalidatePath("/reconciliation");
  revalidatePath("/dashboard");
  revalidatePath("/close");
}

/** Splits an array into chunks so long `in (...)` lists stay within URL limits. */
function chunk<T>(items: T[], size = 150): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ────────────────────────────────────────────────────────────────
// Entities
// ────────────────────────────────────────────────────────────────

const entityEditSchema = z.object({
  entityId: z.string().uuid(),
  name: z.string().trim().min(1, "Enter an entity name.").max(120, "Keep the name under 120 characters."),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code, for example USD or NGN."),
  fiscalYearEnd: z.string().optional(),
});

export async function updateEntity(_prev: ManageState, formData: FormData): Promise<ManageState> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  assertPermission(membership.role, "entities.manage");

  const parsed = entityEditSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the details and try again." };
  const { entityId, name, currency } = parsed.data;
  const fiscalYearEnd = parsed.data.fiscalYearEnd?.trim() ? parsed.data.fiscalYearEnd.trim() : null;
  if (fiscalYearEnd && !/^\d{4}-\d{2}-\d{2}$/.test(fiscalYearEnd)) return { error: "Enter the fiscal year end as a date." };

  const supabase = (await createClient()) as any;
  const { data: before } = await supabase
    .from("entities")
    .select("name, currency, fiscal_year_end")
    .eq("id", entityId)
    .maybeSingle();
  if (!before) return { error: "Entity not found." };

  const { data: updated, error } = await supabase
    .from("entities")
    .update({ name, currency, fiscal_year_end: fiscalYearEnd })
    .eq("id", entityId)
    .select("id");
  if (error) return { error: error.message };
  if (!updated || updated.length === 0) return { error: "Nothing was changed. Only owners and admins can edit an entity." };

  await logAudit(
    supabase,
    membership.organizationId,
    membership.userId,
    "entity.updated",
    "entities",
    entityId,
    { name: before.name, currency: before.currency, fiscal_year_end: before.fiscal_year_end },
    { name, currency, fiscal_year_end: fiscalYearEnd }
  );
  refresh(entityId);
  return { success: "Entity updated." };
}

/**
 * Archiving hides an entity (and all its accounts) from reconciliation, the dashboard
 * workflow and the close, without deleting anything. Restoring brings it all back.
 */
export async function setEntityArchived(entityId: string, archived: boolean): Promise<{ error?: string }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  assertPermission(membership.role, "entities.manage");

  const supabase = (await createClient()) as any;
  const { data: entity } = await supabase.from("entities").select("id, name, archived_at").eq("id", entityId).maybeSingle();
  if (!entity) return { error: "Entity not found." };

  if (archived) {
    if (entity.archived_at) return {};
    const stamp = new Date().toISOString();

    const { data: updated, error } = await supabase.from("entities").update({ archived_at: stamp }).eq("id", entityId).select("id");
    if (error) return { error: error.message };
    if (!updated || updated.length === 0) return { error: "Only owners and admins can archive an entity." };

    // Accounts get the same timestamp so restoring can find exactly the ones archived with the entity.
    await supabase
      .from("accounts")
      .update({ archived_at: stamp, archived_was_reconcilable: true, is_reconcilable: false })
      .eq("entity_id", entityId)
      .is("archived_at", null)
      .eq("is_reconcilable", true);
    await supabase
      .from("accounts")
      .update({ archived_at: stamp, archived_was_reconcilable: false })
      .eq("entity_id", entityId)
      .is("archived_at", null);

    await logAudit(supabase, membership.organizationId, membership.userId, "entity.archived", "entities", entityId, null, { name: entity.name });
  } else {
    if (!entity.archived_at) return {};
    const { data: updated, error } = await supabase.from("entities").update({ archived_at: null }).eq("id", entityId).select("id");
    if (error) return { error: error.message };
    if (!updated || updated.length === 0) return { error: "Only owners and admins can restore an entity." };

    await supabase
      .from("accounts")
      .update({ archived_at: null, is_reconcilable: true, archived_was_reconcilable: null })
      .eq("entity_id", entityId)
      .eq("archived_at", entity.archived_at)
      .eq("archived_was_reconcilable", true);
    await supabase
      .from("accounts")
      .update({ archived_at: null, archived_was_reconcilable: null })
      .eq("entity_id", entityId)
      .eq("archived_at", entity.archived_at);

    await logAudit(supabase, membership.organizationId, membership.userId, "entity.restored", "entities", entityId, null, { name: entity.name });
  }

  refresh(entityId);
  return {};
}

// ────────────────────────────────────────────────────────────────
// Accounts
// ────────────────────────────────────────────────────────────────

const accountEditSchema = z.object({
  accountId: z.string().uuid(),
  name: z.string().trim().min(1, "Enter an account name.").max(120, "Keep the name under 120 characters."),
  code: z.string().trim().min(1, "Enter an account code.").max(20, "Keep the code under 20 characters."),
  accountType: z.enum(ACCOUNT_TYPES),
});

export async function updateAccount(_prev: ManageState, formData: FormData): Promise<ManageState> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  assertPermission(membership.role, "entities.manage");

  const parsed = accountEditSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the details and try again." };
  const { accountId, name, code, accountType } = parsed.data;
  const isReconcilable = formData.get("isReconcilable") === "on";

  const supabase = (await createClient()) as any;
  const { data: before } = await supabase
    .from("accounts")
    .select("id, entity_id, name, code, account_type, is_reconcilable, archived_at")
    .eq("id", accountId)
    .maybeSingle();
  if (!before) return { error: "Account not found." };
  if (before.archived_at) return { error: "Restore this account before editing it." };

  if (code !== before.code) {
    const { data: clash } = await supabase
      .from("accounts")
      .select("id")
      .eq("entity_id", before.entity_id)
      .eq("code", code)
      .neq("id", accountId)
      .limit(1);
    if (clash && clash.length > 0) return { error: `Another account in this entity already uses code ${code}.` };
  }

  const { data: updated, error } = await supabase
    .from("accounts")
    .update({ name, code, account_type: accountType, is_reconcilable: isReconcilable, user_edited: true })
    .eq("id", accountId)
    .select("id");
  if (error) return { error: error.message };
  if (!updated || updated.length === 0) return { error: "Nothing was changed. You may not have permission to edit accounts." };

  await logAudit(
    supabase,
    membership.organizationId,
    membership.userId,
    "account.updated",
    "accounts",
    accountId,
    { name: before.name, code: before.code, type: before.account_type, reconcilable: before.is_reconcilable },
    { name, code, type: accountType, reconcilable: isReconcilable }
  );
  refresh(before.entity_id);
  return { success: "Account updated." };
}

export async function setAccountArchived(accountId: string, archived: boolean): Promise<{ error?: string }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  assertPermission(membership.role, "entities.manage");

  const supabase = (await createClient()) as any;
  const { data: account } = await supabase
    .from("accounts")
    .select("id, entity_id, name, is_reconcilable, archived_at, archived_was_reconcilable")
    .eq("id", accountId)
    .maybeSingle();
  if (!account) return { error: "Account not found." };

  let changes: Record<string, unknown>;
  if (archived) {
    if (account.archived_at) return {};
    changes = { archived_at: new Date().toISOString(), archived_was_reconcilable: account.is_reconcilable, is_reconcilable: false };
  } else {
    if (!account.archived_at) return {};
    const { data: entity } = await supabase.from("entities").select("archived_at").eq("id", account.entity_id).maybeSingle();
    if (entity?.archived_at) return { error: "Restore the entity first." };
    changes = { archived_at: null, is_reconcilable: account.archived_was_reconcilable ?? true, archived_was_reconcilable: null };
  }

  const { data: updated, error } = await supabase.from("accounts").update(changes).eq("id", accountId).select("id");
  if (error) return { error: error.message };
  if (!updated || updated.length === 0) return { error: "Nothing was changed. You may not have permission to do this." };

  await logAudit(supabase, membership.organizationId, membership.userId, archived ? "account.archived" : "account.restored", "accounts", accountId, null, { name: account.name });
  refresh(account.entity_id);
  return {};
}

// ────────────────────────────────────────────────────────────────
// Undo a link
// ────────────────────────────────────────────────────────────────

async function nextAccountCode(supabase: any, entityId: string, accountType: string): Promise<string> {
  const base = TYPE_CODE_RANGES[accountType] ?? 9000;
  const { data } = await supabase.from("accounts").select("code").eq("entity_id", entityId).eq("account_type", accountType);
  const used = ((data ?? []) as { code: string }[])
    .map((a) => parseInt(a.code, 10))
    .filter((n) => Number.isFinite(n) && n >= base && n < base + 1000);
  return String(used.length > 0 ? Math.max(...used) + 1 : base);
}

/**
 * Reverses "Link accounts" for an account that currently holds both a Plaid and a
 * QuickBooks identity: the QuickBooks half is split back out into its own account,
 * together with its transactions. Works for links made before this feature existed,
 * because nothing has to have been recorded at link time.
 *
 * Matches that paired a bank line with a ledger line across the two halves can't
 * stay confirmed once the halves are separate accounts, so they are reset and the
 * transactions return to "unmatched". That is why only owners and controllers (who
 * can delete matches) may do this.
 */
export async function unlinkAccount(accountId: string): Promise<{ error?: string; newAccountName?: string }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  assertPermission(membership.role, "entities.manage");
  if (membership.role !== "owner" && membership.role !== "controller") {
    return { error: "Ask an owner or controller to unlink accounts, because it resets any confirmed matches." };
  }

  const supabase = (await createClient()) as any;
  const { data: account } = await supabase
    .from("accounts")
    .select("id, entity_id, name, account_type, plaid_account_id, quickbooks_account_id, quickbooks_item_id")
    .eq("id", accountId)
    .maybeSingle();
  if (!account) return { error: "Account not found." };
  if (!account.plaid_account_id || !account.quickbooks_account_id) {
    return { error: "This account isn't a link between a bank account and a QuickBooks account." };
  }

  // 1. Free up the QuickBooks identity on this account (it is unique per entity).
  const qbAccountId = account.quickbooks_account_id as string;
  const qbItemId = account.quickbooks_item_id as string | null;
  const { error: clearError } = await supabase
    .from("accounts")
    .update({ quickbooks_account_id: null, quickbooks_item_id: null })
    .eq("id", accountId);
  if (clearError) return { error: clearError.message };

  const restoreIdentity = async () => {
    await supabase.from("accounts").update({ quickbooks_account_id: qbAccountId, quickbooks_item_id: qbItemId }).eq("id", accountId);
  };

  // 2. Create the split-out QuickBooks account.
  const newName = `${account.name} (QuickBooks)`;
  const newCode = await nextAccountCode(supabase, account.entity_id, account.account_type);
  const { data: created, error: createError } = await supabase
    .from("accounts")
    .insert({
      entity_id: account.entity_id,
      name: newName,
      code: newCode,
      account_type: account.account_type,
      is_reconcilable: true,
      source: "quickbooks",
      quickbooks_account_id: qbAccountId,
      quickbooks_item_id: qbItemId,
    })
    .select("id")
    .single();
  if (createError || !created) {
    await restoreIdentity();
    return { error: createError?.message ?? "Could not create the QuickBooks account." };
  }

  // 3. Find the QuickBooks transactions that need to move.
  const { data: moving } = await supabase.from("transactions").select("id").eq("account_id", accountId).eq("source", "quickbooks");
  const movingIds = ((moving ?? []) as { id: string }[]).map((t) => t.id);

  // 4. Reset anything that paired across the two halves.
  const affectedTxnIds = new Set<string>(movingIds);
  for (const ids of chunk(movingIds)) {
    const { data: lines } = await supabase.from("match_lines").select("match_id").in("transaction_id", ids);
    const matchIds = [...new Set(((lines ?? []) as { match_id: string }[]).map((l) => l.match_id))];
    for (const mIds of chunk(matchIds)) {
      const { data: allLines } = await supabase.from("match_lines").select("transaction_id").in("match_id", mIds);
      for (const l of (allLines ?? []) as { transaction_id: string }[]) affectedTxnIds.add(l.transaction_id);
      await supabase.from("match_lines").delete().in("match_id", mIds);
      await supabase.from("matches").delete().in("id", mIds);
    }
    await supabase.from("exceptions").delete().in("transaction_id", ids);
  }
  for (const ids of chunk([...affectedTxnIds])) {
    await supabase.from("transactions").update({ status: "unmatched" }).in("id", ids);
  }

  // 5. Move the transactions across.
  for (const ids of chunk(movingIds)) {
    const { error: moveError } = await supabase.from("transactions").update({ account_id: created.id }).in("id", ids);
    if (moveError) return { error: `The account was split, but moving its transactions failed: ${moveError.message}` };
  }

  // 6. Refresh this account's periods now that its ledger side is gone.
  const { data: recons } = await supabase.from("reconciliations").select("id").eq("account_id", accountId);
  for (const r of (recons ?? []) as { id: string }[]) {
    await recomputeReconciliationStatus(r.id).catch((err: unknown) => console.error("Post-unlink recompute failed:", err));
  }

  await logAudit(
    supabase,
    membership.organizationId,
    membership.userId,
    "account.unlinked",
    "accounts",
    accountId,
    { name: account.name, quickbooks_account_id: qbAccountId },
    { split_into: newName, transactions_moved: movingIds.length }
  );
  refresh(account.entity_id);
  return { newAccountName: newName };
}

// ────────────────────────────────────────────────────────────────
// Banks
// ────────────────────────────────────────────────────────────────

/**
 * Disconnects a bank connection: tells Plaid to revoke access, then marks the connection
 * disconnected so it is never synced again. Accounts and transaction history stay put.
 */
export async function disconnectBank(plaidItemId: string): Promise<{ error?: string }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  assertPermission(membership.role, "entities.manage");

  const supabase = (await createClient()) as any;
  const { data: item } = await supabase
    .from("plaid_items")
    .select("id, organization_id, access_token, institution_name, disconnected_at")
    .eq("id", plaidItemId)
    .maybeSingle();
  if (!item || item.organization_id !== membership.organizationId) return { error: "Bank connection not found." };
  if (item.disconnected_at) return {};

  try {
    await plaidClient.itemRemove({ access_token: item.access_token });
  } catch (err: any) {
    // If Plaid already considers the item gone, carry on and mark it disconnected here too.
    const code = err?.response?.data?.error_code;
    if (code !== "ITEM_NOT_FOUND" && code !== "INVALID_ACCESS_TOKEN") {
      return { error: err?.response?.data?.error_message ?? err?.message ?? "Plaid could not disconnect this bank." };
    }
  }

  const { data: updated, error } = await supabase
    .from("plaid_items")
    .update({ disconnected_at: new Date().toISOString() })
    .eq("id", plaidItemId)
    .select("id");
  if (error) return { error: error.message };
  if (!updated || updated.length === 0) return { error: "The bank was disconnected at Plaid but could not be marked here. Try again." };

  await logAudit(supabase, membership.organizationId, membership.userId, "bank.disconnected", "plaid_items", plaidItemId, null, {
    institution: item.institution_name ?? "Unknown bank",
  });
  refresh();
  return {};
}
