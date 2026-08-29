import { redirect } from "next/navigation";
import { getCurrentMembership } from "@/lib/actions/membership";
import { createClient } from "@/lib/supabase/server";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

export default async function OnboardingPage() {
  const membership = await getCurrentMembership();

  // No org membership at all — shouldn't normally happen (the signup
  // trigger provisions one), but if it does, there's nothing to onboard.
  if (!membership) {
    redirect("/login");
  }

  // Onboarding is only "complete" once an account exists — not merely an
  // entity. We deliberately do NOT call redirect() here based on this
  // check: any Server Action invoked from the wizard (entity creation,
  // account creation) automatically invalidates this route's cache and
  // causes Next.js to re-run this Server Component mid-session. If we
  // redirected here, the moment the account got created this check would
  // flip true and yank the user off the confirmation screen before they
  // ever saw it. Instead we hand the current answer to the client wizard
  // as a prop, and it decides — once, at mount, never again — whether to
  // bounce to the dashboard. That decision then survives every later
  // re-render this Server Component goes through.
  const supabase = await createClient();
  const { data: orgEntities } = await supabase
    .from("entities")
    .select("id")
    .eq("organization_id", membership.organizationId);

  const entityIds = (orgEntities ?? []).map((e) => e.id);
  let hasAccount = false;

  if (entityIds.length > 0) {
    const { count } = await supabase
      .from("accounts")
      .select("id", { count: "exact", head: true })
      .in("entity_id", entityIds);
    hasAccount = (count ?? 0) > 0;
  }

  return <OnboardingWizard organizationName={membership.organizationName} alreadyOnboarded={hasAccount} />;
}
