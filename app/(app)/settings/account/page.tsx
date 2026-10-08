import { getCurrentMembership } from "@/lib/actions/membership";
import { logout } from "@/lib/actions/auth";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/permissions";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { Button } from "@/components/ui/button";

export default async function MyAccountPage() {
  const membership = await getCurrentMembership();
  if (!membership) return null;

  const rows = [
    { label: "Email", value: membership.email },
    { label: "Organization", value: membership.organizationName },
    { label: "Your role", value: `${ROLE_LABELS[membership.role]} — ${ROLE_DESCRIPTIONS[membership.role]}` },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">My account</h1>
        <p className="mt-1 text-sm text-ink-500">Your sign-in details. Only you can see this page.</p>
      </div>

      <section className="rounded-xl border border-ink-100 bg-white p-5 shadow-subtle">
        <h2 className="text-[15px] font-semibold text-ink-900">Profile</h2>
        <dl className="mt-3 divide-y divide-ink-100 text-sm">
          {rows.map((r) => (
            <div key={r.label} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:gap-6">
              <dt className="w-32 shrink-0 text-ink-500">{r.label}</dt>
              <dd className="font-medium text-ink-900">{r.value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-ink-500">To change your email address or role, ask an owner or admin.</p>
      </section>

      <section className="rounded-xl border border-ink-100 bg-white p-5 shadow-subtle">
        <h2 className="text-[15px] font-semibold text-ink-900">Password</h2>
        <p className="mb-4 mt-0.5 text-xs text-ink-500">You&apos;ll stay signed in on this device after changing it.</p>
        <ChangePasswordForm />
      </section>

      <section className="rounded-xl border border-ink-100 bg-white p-5 shadow-subtle">
        <h2 className="text-[15px] font-semibold text-ink-900">Sign out</h2>
        <p className="mb-4 mt-0.5 text-xs text-ink-500">End your session on this device.</p>
        <form action={logout}>
          <Button type="submit" variant="secondary">
            Sign out
          </Button>
        </form>
      </section>
    </div>
  );
}
