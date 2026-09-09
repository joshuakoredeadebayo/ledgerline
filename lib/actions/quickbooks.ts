"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { assertPermission } from "@/lib/permissions";
import { revokeQuickBooksToken } from "@/lib/quickbooks/client";

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
