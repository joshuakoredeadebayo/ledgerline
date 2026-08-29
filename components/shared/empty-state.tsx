import * as React from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

/** Every empty state names what's missing and gives one clear next action —
 *  never just "No data." */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-ink-200 bg-white px-6 py-16 text-center",
        className
      )}
    >
      {icon && <div className="text-ink-300">{icon}</div>}
      <div className="space-y-1">
        <p className="text-sm font-medium text-ink-800">{title}</p>
        {description && <p className="text-sm text-ink-500 max-w-sm">{description}</p>}
      </div>
      {action}
    </div>
  );
}
