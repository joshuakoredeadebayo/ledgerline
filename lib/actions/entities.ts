"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { assertPermission } from "@/lib/permissions";

const entitySchema = z.object({
  name: z.string().min(1, "Enter an entity name."),
  currency: z.string().min(3).max(3).default("USD"),
});

export type ActionState =
  | { error?: string; fieldErrors?: Record<string, string>; success?: boolean; entityId?: string }
  | null;

export async function createEntity(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };

  assertPermission(membership.role, "entities.manage");

  const parsed = entitySchema.safeParse({
    name: formData.get("name"),
    currency: formData.get("currency") || "USD",
  });
  if (!parsed.success) {
    return { fieldErrors: Object.fromEntries(parsed.error.issues.map((i) => [i.path[0], i.message])) };
  }

  const supabase = await createClient();
  const { data: entity, error } = await supabase
    .from("entities")
    .insert({
      organization_id: membership.organizationId,
      name: parsed.data.name,
      currency: parsed.data.currency,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  await logAudit(membership.organizationId, membership.userId, "entity.created", "entities", entity.id, {
    name: parsed.data.name,
  });

  revalidatePath("/entities");
  return { success: true, entityId: entity.id };
}


const accountSchema = z.object({
  entityId: z.string().uuid(),
  name: z.string().min(1, "Enter an account name."),
  account_type: z.enum(["asset", "liability", "equity", "revenue", "expense"]),
});

// Standard chart-of-accounts numbering ranges. Codes are generated, not
// typed in — each type gets its own block, and the next free number in
// that block is assigned automatically when an account is created.
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

export async function createAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };

  assertPermission(membership.role, "entities.manage");

  const parsed = accountSchema.safeParse({
    entityId: formData.get("entityId"),
    name: formData.get("name"),
    account_type: formData.get("account_type"),
  });
  if (!parsed.success) {
    return { fieldErrors: Object.fromEntries(parsed.error.issues.map((i) => [i.path[0], i.message])) };
  }

  const supabase = await createClient();
  const code = await generateNextAccountCode(supabase, parsed.data.entityId, parsed.data.account_type);

  const { error } = await supabase.from("accounts").insert({
    entity_id: parsed.data.entityId,
    name: parsed.data.name,
    account_type: parsed.data.account_type,
    code,
    is_reconcilable: true,
  });

  if (error) return { error: error.message };

  revalidatePath(`/entities/${parsed.data.entityId}`);
  revalidatePath("/reconciliation");
  return { success: true };
}

async function logAudit(
  organizationId: string,
  actorId: string,
  action: string,
  targetTable: string,
  targetId: string | null,
  after: Record<string, unknown>
) {
  const supabase = await createClient();
  await supabase.from("audit_log").insert({
    organization_id: organizationId,
    actor_id: actorId,
    action,
    target_table: targetTable,
    target_id: targetId,
    after,
  });
}
