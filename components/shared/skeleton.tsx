import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-ink-100", className)} />;
}

/** Skeleton rows matching the shape of the reconciliation/JE tables. */
export function TableSkeleton({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-ink-100 rounded-lg border border-ink-100 bg-white">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={c === 0 ? "h-4 w-32" : "h-4 flex-1"} />
          ))}
        </div>
      ))}
    </div>
  );
}
