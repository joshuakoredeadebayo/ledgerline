import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/permissions";

export interface CurrentMembership {
  userId: string;
  email: string;
  organizationId: string;
  organizationName: string;
  role: Role;
}

/**
 * Resolves the signed-in user's active organization membership.
 * For v1, "active org" = the first joined membership; once multi-org
 * switching ships, this reads the active-org cookie set by the org switcher.
 *
 * Reads the verified user id/email from headers set by middleware
 * rather than calling supabase.auth.getUser() again here. Middleware
 * already made that network round-trip to Supabase Auth once per
 * request — calling it a second time in this layout, which reruns on
 * every navigation, was doubling that latency for no extra security
 * benefit (middleware's result is authoritative and can't be spoofed,
 * since it always overwrites these headers itself).
 */
export async function getCurrentMembership(): Promise<CurrentMembership | null> {
  const headerList = await headers();
  const userId = headerList.get("x-user-id");
  const email = headerList.get("x-user-email") ?? "";

  if (!userId) return null;

  const supabase = await createClient();

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id, role, organizations(name)")
    .eq("user_id", userId)
    .not("joined_at", "is", null)
    .limit(1)
    .maybeSingle();

  if (!membership) return null;

  return {
    userId,
    email,
    organizationId: membership.organization_id,
    organizationName: (membership.organizations as unknown as { name: string })?.name ?? "Organization",
    role: membership.role as Role,
  };
}