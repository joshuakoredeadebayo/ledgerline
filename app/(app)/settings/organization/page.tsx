import { getCurrentMembership } from "@/lib/actions/membership";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS } from "@/lib/permissions";
import { OrganizationNameForm } from "@/components/settings/organization-name-form";

export default async function OrganizationSettingsPage() {
  const membership = await getCurrentMembership();
  if (!membership) return null;

  // Cast to `any`: keeps these reads independent of the generated DB types.
  const supabase = (await createClient()) as any;

  const [{ data: org }, { count: memberCount }, { count: entityCount }] = await Promise.all([
    supabase.from("organizations").select("name, plan, created_at").eq("id", membership.organizationId).single(),
    supabase
      .from("organization_members")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", membership.organizationId)
      .not("joined_at", "is", null),
    supabase.from("entities").select("id", { count: "exact", head: true }).eq("organization_id", membership.organizationId),
  ]);

  const details = [
    { label: "Plan", value: org?.plan ? String(org.plan).replace(/^./, (c: string) => c.toUpperCase()) : "—" },
    {
      label: "Created",
      value: org?.created_at
        ? new Date(org.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
        : "—",
    },
    { label: "Members", value: String(memberCount ?? 0) },
    { label: "Entities", value: String(entityCount ?? 0) },
    { label: "Your role", value: ROLE_LABELS[membership.role] },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Organization</h1>
        <p className="mt-1 text-sm text-ink-500">The company workspace everyone on your team signs in to.</p>
      </div>

      <section className="rounded-xl border border-ink-100 bg-white p-5 shadow-subtle">
        <OrganizationNameForm name={org?.name ?? membership.organizationName} canEdit={membership.role === "owner"} />
      </section>

      <section className="rounded-xl border border-ink-100 bg-white p-5 shadow-subtle">
        <h2 className="text-[15px] font-semibold text-ink-900">Details</h2>
        <dl className="mt-3 divide-y divide-ink-100 text-sm">
          {details.map((d) => (
            <div key={d.label} className="flex items-center justify-between py-2.5">
              <dt className="text-ink-500">{d.label}</dt>
              <dd className="font-medium text-ink-900">{d.value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
