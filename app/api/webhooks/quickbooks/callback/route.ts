import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentMembership } from "@/lib/actions/membership";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { exchangeCodeForTokens, getCompanyInfo, QUICKBOOKS_STATE_COOKIE } from "@/lib/quickbooks/client";

export async function GET(request: NextRequest) {
  const redirectBase = request.nextUrl.origin;
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const realmId = request.nextUrl.searchParams.get("realmId");
  const errorParam = request.nextUrl.searchParams.get("error");

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(QUICKBOOKS_STATE_COOKIE)?.value;
  cookieStore.delete(QUICKBOOKS_STATE_COOKIE);

  if (errorParam) {
    // The person declined on Intuit's consent screen, or Intuit itself
    // reported a problem — either way, nothing to exchange.
    return NextResponse.redirect(`${redirectBase}/settings/integrations?error=${encodeURIComponent(errorParam)}`);
  }

  if (!code || !realmId || !state || state !== expectedState) {
    // Missing/mismatched state means this isn't a redirect we actually
    // initiated — reject rather than proceed with an unverified request.
    return NextResponse.redirect(`${redirectBase}/settings/integrations?error=invalid_state`);
  }

  const membership = await getCurrentMembership();
  if (!membership || !can(membership.role, "org.manage_integrations")) {
    return NextResponse.redirect(`${redirectBase}/settings/integrations?error=forbidden`);
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const company = await getCompanyInfo(realmId, tokens.accessToken);

    const supabase = await createClient();
    const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000).toISOString();

    const { error } = await supabase.from("quickbooks_items").upsert(
      {
        organization_id: membership.organizationId,
        realm_id: realmId,
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        access_token_expires_at: expiresAt,
        company_name: company.companyName,
        status: "active",
        created_by: membership.userId,
      },
      { onConflict: "organization_id,realm_id" }
    );

    if (error) {
      return NextResponse.redirect(`${redirectBase}/settings/integrations?error=${encodeURIComponent(error.message)}`);
    }

    return NextResponse.redirect(`${redirectBase}/settings/integrations?connected=1`);
  } catch (err: any) {
    return NextResponse.redirect(
      `${redirectBase}/settings/integrations?error=${encodeURIComponent(err.message ?? "Unknown error connecting QuickBooks.")}`
    );
  }
}
