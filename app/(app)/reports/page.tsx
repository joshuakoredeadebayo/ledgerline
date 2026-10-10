import Link from "next/link";
import { AlertTriangle, ChevronRight, ClipboardList, FileCheck2 } from "lucide-react";
import { getCurrentMembership } from "@/lib/actions/membership";
import { can } from "@/lib/permissions";
import { EmptyState } from "@/components/shared/empty-state";

const REPORTS = [
  {
    href: "/reports/reconciliation",
    title: "Reconciliation report",
    description: "For one account and month: what was matched, what was explained and why, what is still open, and who signed it off.",
    icon: FileCheck2,
  },
  {
    href: "/reports/period-summary",
    title: "Period summary",
    description: "Every reconciled account for a month on one page: status, difference, open items and who finalized it. A quick close review.",
    icon: ClipboardList,
  },
  {
    href: "/reports/exceptions",
    title: "Exception aging",
    description: "Open exceptions grouped by how long they have been waiting, oldest first, so nothing sits unnoticed.",
    icon: AlertTriangle,
  },
];

export default async function ReportsPage() {
  const membership = await getCurrentMembership();
  if (!membership) return null;
  if (!can(membership.role, "reports.view")) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState title="You don't have access to reports" description="Ask an owner if you need it." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Reports</h1>
        <p className="mt-1 text-sm text-ink-500">
          Every report can be printed or saved as a PDF, and downloaded as a spreadsheet (CSV). For a record of who did what, see the audit log under Settings.
        </p>
      </div>
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {REPORTS.map((r) => (
          <li key={r.href}>
            <Link href={r.href} className="flex h-full flex-col rounded-xl border border-ink-100 bg-white p-5 shadow-subtle transition-shadow hover:shadow-panel">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-50 text-accent-600">
                <r.icon className="h-4 w-4" />
              </span>
              <span className="mt-4 flex items-center justify-between text-[15px] font-semibold text-ink-900">
                {r.title}
                <ChevronRight className="h-4 w-4 text-ink-300" />
              </span>
              <span className="mt-1.5 text-sm text-ink-500">{r.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
