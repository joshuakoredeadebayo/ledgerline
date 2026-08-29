import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-16 items-center justify-between border-b border-ink-100 px-6">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded bg-accent-500" />
          <span className="text-lg font-semibold text-ink-900">Ledgerline</span>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/login" className="text-sm font-medium text-ink-600 hover:text-ink-900">
            Sign in
          </Link>
          <Button asChild size="sm">
            <Link href="/signup">Get started</Link>
          </Button>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <h1 className="max-w-2xl text-3xl font-semibold text-ink-900 sm:text-4xl">
          Reconciliation and close, done right.
        </h1>
        <p className="mt-4 max-w-xl text-base text-ink-500">
          Bank and ledger reconciliation, close checklists, and audit trails built for mid-market
          finance teams — without the enterprise price tag.
        </p>
        <Button asChild size="lg" className="mt-8">
          <Link href="/signup">Start your pilot</Link>
        </Button>
      </main>
    </div>
  );
}
