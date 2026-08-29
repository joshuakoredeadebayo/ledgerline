import { cn } from "@/lib/utils";

export interface ConfidenceScoreProps {
  /** 0–1 */
  score: number;
  className?: string;
}

/** Visual read on how confident the matching engine is about a suggested match.
 *  Thresholds: >=0.85 high (auto-suggested, one click to confirm),
 *  0.6-0.85 medium (needs a look), <0.6 low (surfaced but expect manual work). */
export function ConfidenceScore({ score, className }: ConfidenceScoreProps) {
  const pct = Math.round(score * 100);
  const tier = score >= 0.85 ? "high" : score >= 0.6 ? "medium" : "low";

  const tierColor = {
    high: "text-status-matched",
    medium: "text-status-pending",
    low: "text-status-exception",
  }[tier];

  const barColor = {
    high: "bg-status-matched",
    medium: "bg-status-pending",
    low: "bg-status-exception",
  }[tier];

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-ink-100">
        <div
          className={cn("h-full rounded-full", barColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={cn("text-xs font-medium tabular-nums", tierColor)}>{pct}%</span>
    </div>
  );
}
