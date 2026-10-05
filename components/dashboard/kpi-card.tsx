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
 *
 * The value and badge sit in a wrapping row: when the card is too narrow for
 * both, the badge drops under the value instead of being clipped.
 */
export function KpiCard({
  icon,
  label,
  value,
  badge,
  subtext,
  tone = "neutral",
  href,
  className,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  badge?: React.ReactNode;
  subtext?: React.ReactNode;
  tone?: KpiTone;
  href?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", toneIcon[tone])}>{icon}</span>
          <span className="text-sm font-medium text-ink-600">{label}</span>
        </div>
        {href && <ChevronRight className="h-4 w-4 shrink-0 text-ink-300" />}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-[1.5rem] font-semibold leading-8 2xl:text-[1.75rem] tracking-tight tabular-nums text-ink-900">{value}</span>
        {badge && <span className="shrink-0 whitespace-nowrap">{badge}</span>}
      </div>
      {children}
      {subtext && <p className="mt-2.5 text-xs text-ink-500">{subtext}</p>}
    </>
  );

  const classes = cn("block rounded-xl border border-ink-100 bg-white p-5 shadow-subtle", className);
  return href ? (
    <Link href={href} className={cn(classes, "transition-shadow hover:shadow-panel")}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}
