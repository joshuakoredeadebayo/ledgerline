export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2">
          <div className="h-6 w-6 rounded bg-accent-500" />
          <span className="text-lg font-semibold text-ink-900">Ledgerline</span>
        </div>
        <div className="rounded-lg border border-ink-100 bg-white p-6 shadow-subtle">
          {children}
        </div>
      </div>
    </div>
  );
}
