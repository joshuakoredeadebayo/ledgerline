import { getCurrentMembership } from "@/lib/actions/membership";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS } from "@/lib/permissions";
import { OrganizationNameForm } from "@/components/settings/organization-name-form";
import { withFallback } from "@/lib/safe-query";
import { loadSchemaHealth, sqlFileFor } from "@/components/layout/database-banner";
import { SignoffPolicyToggle } from "@/components/settings/signoff-policy-toggle";

export default async function OrganizationSettingsPage() {
  const membership = await getCurrentMembership();
  if (!membership) return null;

  // Cast to `any`: keeps these reads independent of the generated DB types.
  const supabase = (await createClient()) as any;

  const [{ data: org }, { count: memberCount }, { count: entityCount }] = await Promise.all([
    withFallback(
      () => supabase.from("organizations").select("name, plan, created_at, require_signoff").eq("id", membership.organizationId).single(),
      () => supabase.from("organizations").select("name, plan, created_at").eq("id", membership.organizationId).single()
    ),
    supabase
      .from("organization_members")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", membership.organizationId)
      .not("joined_at", "is", null),
    supabase.from("entities").select("id", { count: "exact", head: true }).eq("organization_id", membership.organizationId),
  ]);

  const schemaChecks = membership.role === "owner" || membership.role === "admin" ? await loadSchemaHealth() : null;
  const showHealth = membership.role === "owner" || membership.role === "admin";

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

      {showHealth && (
        <section className="rounded-xl border border-ink-100 bg-white p-5 shadow-subtle">
          <h2 className="text-[15px] font-semibold text-ink-900">Database updates</h2>
          <p className="mb-3 mt-0.5 text-xs text-ink-500">
            Ledgerline&apos;s database is updated with numbered SQL files, run once each in the Supabase SQL editor. This shows which have been run.
          </p>
          {schemaChecks === null ? (
            <p className="text-sm text-ink-700">
              This check isn&apos;t installed yet. Run <span className="font-medium">0017_schema_health.sql</span> in the Supabase SQL editor to turn it on.
            </p>
          ) : (
            <ul className="divide-y divide-ink-100 text-sm">
              {schemaChecks.map((c) => (
                <li key={c.migration} className="flex items-start justify-between gap-4 py-2.5">
                  <span className="text-ink-800">
                    <span className="font-medium text-ink-900">{c.migration}</span> · {c.description}
                    {!c.applied && <span className="block text-xs text-status-exception">Not run yet. Run {sqlFileFor(c.migration)}.</span>}
                  </span>
                  <span className={c.applied ? "text-status-matched" : "font-medium text-status-exception"}>{c.applied ? "Done" : "Missing"}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="rounded-xl border border-ink-100 bg-white p-5 shadow-subtle">
        <h2 className="mb-3 text-[15px] font-semibold text-ink-900">Approvals</h2>
        <SignoffPolicyToggle initial={!!org?.require_signoff} canEdit={membership.role === "owner"} />
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
