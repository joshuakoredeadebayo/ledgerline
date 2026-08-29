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
 */
export async function getCurrentMembership(): Promise<CurrentMembership | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id, role, organizations(name)")
    .eq("user_id", user.id)
    .not("joined_at", "is", null)
    .limit(1)
    .maybeSingle();

  if (!membership) return null;

  return {
    userId: user.id,
    email: user.email ?? "",
    organizationId: membership.organization_id,
    organizationName: (membership.organizations as unknown as { name: string })?.name ?? "Organization",
    role: membership.role as Role,
  };
}
