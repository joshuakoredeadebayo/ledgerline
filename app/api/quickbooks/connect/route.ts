import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { getCurrentMembership } from "@/lib/actions/membership";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { getQuickBooksAuthUrl, QUICKBOOKS_ENTITY_COOKIE, QUICKBOOKS_STATE_COOKIE } from "@/lib/quickbooks/client";

/**
 * Starts the QuickBooks OAuth flow. With ?entityId=..., the resulting connection belongs to
 * that entity; without it, it becomes a shared, organization-wide connection.
 */
export async function GET(request: NextRequest) {
  const membership = await getCurrentMembership();
  if (!membership || !can(membership.role, "org.manage_integrations")) {
    return NextResponse.redirect(new URL("/settings/integrations?error=forbidden", request.nextUrl.origin));
  }

  const entityId = request.nextUrl.searchParams.get("entityId");
  if (entityId) {
    // Row-level security means this only finds entities in the signed-in person's own organization.
    const supabase = (await createClient()) as any;
    const { data: entity } = await supabase.from("entities").select("id, archived_at").eq("id", entityId).maybeSingle();
    if (!entity || entity.archived_at) {
      return NextResponse.redirect(new URL("/settings/integrations?error=entity_not_found", request.nextUrl.origin));
    }
  }

  const state = randomBytes(24).toString("hex");
  const cookieStore = await cookies();
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 600, // 10 minutes — plenty of time for the OAuth round trip
    path: "/",
  };
  cookieStore.set(QUICKBOOKS_STATE_COOKIE, state, cookieOptions);
  if (entityId) cookieStore.set(QUICKBOOKS_ENTITY_COOKIE, entityId, cookieOptions);
  else cookieStore.delete(QUICKBOOKS_ENTITY_COOKIE);

  return NextResponse.redirect(getQuickBooksAuthUrl(state));
}
