import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentMembership } from "@/lib/actions/membership";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import {
  exchangeCodeForTokens,
  getCompanyInfo,
  QUICKBOOKS_ENTITY_COOKIE,
  QUICKBOOKS_STATE_COOKIE,
} from "@/lib/quickbooks/client";

export async function GET(request: NextRequest) {
  const redirectBase = request.nextUrl.origin;
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const realmId = request.nextUrl.searchParams.get("realmId");
  const errorParam = request.nextUrl.searchParams.get("error");

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(QUICKBOOKS_STATE_COOKIE)?.value;
  const entityId = cookieStore.get(QUICKBOOKS_ENTITY_COOKIE)?.value ?? null;
  cookieStore.delete(QUICKBOOKS_STATE_COOKIE);
  cookieStore.delete(QUICKBOOKS_ENTITY_COOKIE);

  const fail = (message: string) =>
    NextResponse.redirect(`${redirectBase}/settings/integrations?error=${encodeURIComponent(message)}`);

  if (errorParam) {
    // The person declined on Intuit's consent screen, or Intuit itself
    // reported a problem — either way, nothing to exchange.
    return fail(errorParam);
  }

  if (!code || !realmId || !state || state !== expectedState) {
    // Missing/mismatched state means this isn't a redirect we actually
    // initiated — reject rather than proceed with an unverified request.
    return fail("invalid_state");
  }

  const membership = await getCurrentMembership();
  if (!membership || !can(membership.role, "org.manage_integrations")) {
    return fail("forbidden");
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const company = await getCompanyInfo(realmId, tokens.accessToken);

    const supabase = (await createClient()) as any;
    const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000).toISOString();

    const { data: existing } = await supabase
      .from("quickbooks_items")
      .select("id, entity_id")
      .eq("organization_id", membership.organizationId)
      .eq("realm_id", realmId)
      .maybeSingle();

    if (entityId) {
      // One QuickBooks company belongs to one entity.
      if (existing?.entity_id && existing.entity_id !== entityId) {
        const { data: owner } = await supabase.from("entities").select("name").eq("id", existing.entity_id).maybeSingle();
        return fail(`${company.companyName} is already connected to ${owner?.name ?? "another entity"}.`);
      }

      // QuickBooks account ids are only unique inside one company, so an entity can't mix
      // accounts imported from two different companies.
      const { data: boundElsewhere } = await supabase
        .from("accounts")
        .select("id")
        .eq("entity_id", entityId)
        .not("quickbooks_item_id", "is", null)
        .neq("quickbooks_item_id", existing?.id ?? "00000000-0000-0000-0000-000000000000")
        .limit(1);
      if (boundElsewhere && boundElsewhere.length > 0) {
        return fail("That entity already has accounts imported from a different QuickBooks company.");
      }
    }

    const { data: saved, error } = await supabase
      .from("quickbooks_items")
      .upsert(
        {
          organization_id: membership.organizationId,
          realm_id: realmId,
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
          access_token_expires_at: expiresAt,
          company_name: company.companyName,
          status: "active",
          created_by: membership.userId,
          // Only set when connecting for a specific entity; reconnecting a shared connection leaves it alone.
          ...(entityId ? { entity_id: entityId } : {}),
        },
        { onConflict: "organization_id,realm_id" }
      )
      .select("id")
      .single();

    if (error) return fail(error.message);

    await supabase.from("audit_log").insert({
      organization_id: membership.organizationId,
      actor_id: membership.userId,
      action: "quickbooks.connected",
      target_table: "quickbooks_items",
      target_id: saved?.id ?? null,
      after: { company: company.companyName, entity_id: entityId },
    });

    return NextResponse.redirect(entityId ? `${redirectBase}/entities/${entityId}?qb=connected` : `${redirectBase}/settings/integrations?connected=1`);
  } catch (err: any) {
    return fail(err.message ?? "Unknown error connecting QuickBooks.");
  }
}
