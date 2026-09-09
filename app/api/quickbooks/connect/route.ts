import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { getCurrentMembership } from "@/lib/actions/membership";
import { can } from "@/lib/permissions";
import { getQuickBooksAuthUrl, QUICKBOOKS_STATE_COOKIE } from "@/lib/quickbooks/client";

export async function GET(request: NextRequest) {
  const membership = await getCurrentMembership();
  if (!membership || !can(membership.role, "org.manage_integrations")) {
    return NextResponse.redirect(new URL("/settings/integrations?error=forbidden", request.nextUrl.origin));
  }

  const state = randomBytes(24).toString("hex");
  const cookieStore = await cookies();
  cookieStore.set(QUICKBOOKS_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10 minutes — plenty of time for the OAuth round trip
    path: "/",
  });

  return NextResponse.redirect(getQuickBooksAuthUrl(state));
}
