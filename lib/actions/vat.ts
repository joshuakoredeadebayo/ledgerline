"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { assertPermission } from "@/lib/permissions";

export interface VatSettingsInput {
  entityId: string;
  registered: boolean;
  vatNumber: string;
  ratePercent: number;
  outputAccountId: string | null;
  inputAccountId: string | null;
  recoverablePercent: number;
}

const TYPE_RANGES: Record<string, number> = { asset: 1000, liability: 2000, equity: 3000, revenue: 4000, expense: 5000 };

async function nextCode(supabase: any, entityId: string, accountType: string): Promise<string> {
  const base = TYPE_RANGES[accountType] ?? 9000;
  const { data } = await supabase.from("accounts").select("code").eq("entity_id", entityId).eq("account_type", accountType);
  const used = ((data ?? []) as { code: string }[])
    .map((a) => parseInt(a.code, 10))
    .filter((n) => Number.isFinite(n) && n >= base && n < base + 1000);
  return String(used.length > 0 ? Math.max(...used) + 1 : base);
}

const twoDecimals = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;

export async function saveVatSettings(input: VatSettingsInput): Promise<{ error?: string }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  assertPermission(membership.role, "entities.manage");

  if (!Number.isFinite(input.ratePercent) || input.ratePercent <= 0 || input.ratePercent > 100 || !twoDecimals(input.ratePercent)) {
    return { error: "Enter the VAT rate as a percentage between 0 and 100, with at most two decimal places (7.5 for Nigeria)." };
  }
  if (!Number.isFinite(input.recoverablePercent) || input.recoverablePercent < 0 || input.recoverablePercent > 100 || !twoDecimals(input.recoverablePercent)) {
    return { error: "The recoverable share of input VAT must be between 0 and 100." };
  }
  const vatNumber = input.vatNumber.trim();
  if (vatNumber.length > 30 || !/^[A-Za-z0-9\-\/ ]*$/.test(vatNumber)) return { error: "The VAT or tax ID number can only contain letters, numbers, spaces, hyphens and slashes." };

  const supabase = (await createClient()) as any;
  const { data: entity } = await supabase
    .from("entities")
    .select("id, name, vat_registered, vat_number, vat_rate, vat_output_account_id, vat_input_account_id, vat_input_recoverable_percent")
    .eq("id", input.entityId)
    .maybeSingle();
  if (!entity) return { error: "Entity not found." };

  // The VAT accounts must belong to this entity and be the right kind of account.
  const ids = [input.outputAccountId, input.inputAccountId].filter(Boolean) as string[];
  if (ids.length > 0) {
    const { data: accounts } = await supabase.from("accounts").select("id, entity_id, account_type, archived_at").in("id", ids);
    const byId = new Map<string, any>(((accounts ?? []) as any[]).map((a) => [a.id, a]));
    const out = input.outputAccountId ? byId.get(input.outputAccountId) : null;
    const inp = input.inputAccountId ? byId.get(input.inputAccountId) : null;
    if (input.outputAccountId && (!out || out.entity_id !== input.entityId || out.archived_at)) return { error: "The Output VAT account must be an active account of this entity." };
    if (input.inputAccountId && (!inp || inp.entity_id !== input.entityId || inp.archived_at)) return { error: "The Input VAT account must be an active account of this entity." };
    if (out && out.account_type !== "liability") return { error: "Output VAT is owed to the tax authority, so it must be a liability account." };
    if (inp && inp.account_type !== "asset" && inp.account_type !== "liability") return { error: "Input VAT is recoverable, so it must be an asset account (or a VAT liability account)." };
    if (input.outputAccountId && input.outputAccountId === input.inputAccountId) return { error: "Output VAT and Input VAT need separate accounts." };
  }

  const { data: updated, error } = await supabase
    .from("entities")
    .update({
      vat_registered: input.registered,
      vat_number: vatNumber || null,
      vat_rate: input.ratePercent,
      vat_output_account_id: input.outputAccountId,
      vat_input_account_id: input.inputAccountId,
      vat_input_recoverable_percent: input.recoverablePercent,
    })
    .eq("id", input.entityId)
    .select("id");
  if (error) return { error: error.message };
  if (!updated || updated.length === 0) return { error: "Nothing was changed. Only owners and admins can edit VAT settings." };

  await supabase.from("audit_log").insert({
    organization_id: membership.organizationId,
    entity_id: input.entityId,
    actor_id: membership.userId,
    action: "entity.vat_settings_updated",
    target_table: "entities",
    target_id: input.entityId,
    before: {
      registered: entity.vat_registered,
      number: entity.vat_number,
      rate: Number(entity.vat_rate),
      output_account: entity.vat_output_account_id,
      input_account: entity.vat_input_account_id,
      recoverable_percent: Number(entity.vat_input_recoverable_percent),
    },
    after: {
      registered: input.registered,
      number: vatNumber || null,
      rate: input.ratePercent,
      output_account: input.outputAccountId,
      input_account: input.inputAccountId,
      recoverable_percent: input.recoverablePercent,
    },
  });

  revalidatePath(`/entities/${input.entityId}`);
  revalidatePath("/journal-entries", "layout");
  revalidatePath("/reports", "layout");
  revalidatePath("/dashboard");
  return {};
}

/** Creates "Output VAT payable" and "Input VAT recoverable" accounts for the entity, if it has none set. */
export async function createVatAccounts(entityId: string): Promise<{ error?: string; outputAccountId?: string; inputAccountId?: string }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  assertPermission(membership.role, "entities.manage");

  const supabase = (await createClient()) as any;
  const { data: entity } = await supabase
    .from("entities")
    .select("id, vat_output_account_id, vat_input_account_id")
    .eq("id", entityId)
    .maybeSingle();
  if (!entity) return { error: "Entity not found." };

  const make = async (name: string, type: "liability" | "asset") => {
    const { data: existing } = await supabase.from("accounts").select("id").eq("entity_id", entityId).eq("name", name).is("archived_at", null).maybeSingle();
    if (existing) return existing.id as string;
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = await nextCode(supabase, entityId, type);
      const { data, error } = await supabase
        .from("accounts")
        .insert({ entity_id: entityId, name, account_type: type, code, is_reconcilable: false })
        .select("id")
        .single();
      if (!error && data) return data.id as string;
      if (error?.code !== "23505") throw new Error(error?.message ?? "Could not create the account.");
    }
    throw new Error("Could not create the account.");
  };

  try {
    const outputId = entity.vat_output_account_id ?? (await make("Output VAT payable", "liability"));
    const inputId = entity.vat_input_account_id ?? (await make("Input VAT recoverable", "asset"));
    const { error } = await supabase.from("entities").update({ vat_output_account_id: outputId, vat_input_account_id: inputId }).eq("id", entityId);
    if (error) return { error: error.message };

    await supabase.from("audit_log").insert({
      organization_id: membership.organizationId,
      entity_id: entityId,
      actor_id: membership.userId,
      action: "entity.vat_accounts_created",
      target_table: "entities",
      target_id: entityId,
      after: { output_account: outputId, input_account: inputId },
    });
    revalidatePath(`/entities/${entityId}`);
    revalidatePath("/journal-entries", "layout");
    return { outputAccountId: outputId, inputAccountId: inputId };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not create the VAT accounts." };
  }
}
