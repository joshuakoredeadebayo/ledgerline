import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type KpiTone = "exception" | "pending" | "info" | "matched" | "neutral";

const toneIcon: Record<KpiTone, string> = {
  exception: "bg-status-exceptionBg text-status-exception",
  pending: "bg-status-pendingBg text-status-pending",
  info: "bg-status-infoBg text-status-info",
  matched: "bg-status-matchedBg text-status-matched",
  neutral: "bg-ink-100 text-ink-500",
};

/**
 * Headline number card. Pass `href` to make the whole card a link (with a
 * chevron); omit it for a static card.
 */
export function KpiCard({
  icon,
  label,
  value,
  badge,
  subtext,
  tone = "neutral",
  href,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  badge?: React.ReactNode;
  subtext?: React.ReactNode;
  tone?: KpiTone;
  href?: string;
  children?: React.ReactNode;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className={cn("flex h-8 w-8 items-center justify-center rounded-md", toneIcon[tone])}>{icon}</span>
          <span className="text-sm font-medium text-ink-700">{label}</span>
        </div>
        {href && <ChevronRight className="h-4 w-4 text-ink-300" />}
      </div>
      <div className="mt-4 flex items-center justify-between gap-2">
        <span className="text-2xl font-semibold tabular-nums text-ink-900">{value}</span>
        {badge}
      </div>
      {children}
      {subtext && <p className="mt-2 text-xs text-ink-500">{subtext}</p>}
    </>
  );

  const classes = "block rounded-lg border border-ink-100 bg-white p-4 shadow-subtle";
  return href ? (
    <Link href={href} className={cn(classes, "transition-shadow hover:shadow-panel")}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}
