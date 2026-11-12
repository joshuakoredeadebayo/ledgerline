import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/** Button styles that read well on the blue banner: a white button, and a see-through one. */
export const HERO_BUTTON =
  "inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-white px-5 text-sm font-semibold text-accent-700 shadow-sm transition-colors hover:bg-white/90";
export const HERO_BUTTON_GHOST =
  "inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-white/30 bg-white/10 px-5 text-sm font-semibold text-white transition-colors hover:bg-white/20";

/**
 * The banner at the top of a page: a blue gradient with soft curves, the page title and a short description,
 * a way back, and room for actions on the right. Printing hides it, since reports have their own headings.
 */
export function PageHero({
  title,
  description,
  back,
  actions,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  back?: { href: string; label: string };
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-2xl bg-gradient-to-r from-accent-500 via-[#0c09cf] to-navy-800 px-7 py-6 text-white shadow-hero print:hidden sm:px-8",
        className
      )}
    >
      <svg aria-hidden viewBox="0 0 1200 220" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
        <path d="M640 220 C 760 150, 860 70, 980 96 S 1130 40, 1200 0 L1200 220 Z" fill="#02007C" opacity="0.38" />
        <path d="M820 220 C 900 170, 980 140, 1060 150 S 1160 120, 1200 90 L1200 220 Z" fill="#010146" opacity="0.4" />
        <path d="M-40 0 C 120 40, 300 20, 470 -10 L470 -20 L-40 -20 Z" fill="#ffffff" opacity="0.06" />
      </svg>

      <div className="relative z-10 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {back && (
            <Link href={back.href} className="mb-2.5 inline-flex items-center gap-2 text-sm font-medium text-white/90 hover:text-white">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/15">
                <ArrowLeft className="h-3.5 w-3.5" />
              </span>
              {back.label}
            </Link>
          )}
          <h1 className="text-[1.9rem] font-bold leading-tight tracking-tight text-white">{title}</h1>
          {description && <p className="mt-1.5 max-w-3xl text-[15px] leading-relaxed text-white/85">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="relative z-10 mt-4">{children}</div>}
    </section>
  );
}
