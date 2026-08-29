import * as React from "react";
import { cn } from "@/lib/utils";

// The four semantic statuses used consistently across the entire product.
// Never repurpose these colors for anything outside their meaning below.
export type BadgeStatus = "matched" | "pending" | "exception" | "info" | "neutral";

const statusStyles: Record<BadgeStatus, string> = {
  matched: "bg-status-matchedBg text-status-matched",
  pending: "bg-status-pendingBg text-status-pending",
  exception: "bg-status-exceptionBg text-status-exception",
  info: "bg-status-infoBg text-status-info",
  neutral: "bg-ink-100 text-ink-600",
};

const statusLabel: Record<BadgeStatus, string> = {
  matched: "Matched",
  pending: "Pending review",
  exception: "Exception",
  info: "In sync",
  neutral: "—",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: BadgeStatus;
  /** Override the default label text while keeping the status color/meaning. */
  label?: string;
}

export function Badge({ status, label, className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        statusStyles[status],
        className
      )}
      {...props}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full bg-current"
      />
      {label ?? statusLabel[status]}
    </span>
  );
}
