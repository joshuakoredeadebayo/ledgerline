import { BrandLogo } from "@/components/layout/brand-logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-navy-900 via-navy-950 to-navy-950 px-4 py-10">
      <svg aria-hidden viewBox="0 0 1200 800" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
        <path d="M0 560 C 260 520, 520 640, 800 760 L800 800 L0 800 Z" fill="#100DED" opacity="0.55" />
        <path d="M0 650 C 300 640, 560 720, 900 800 L0 800 Z" fill="#02007C" opacity="0.7" />
        <path d="M760 0 C 900 120, 1040 160, 1200 120 L1200 0 Z" fill="#100DED" opacity="0.35" />
      </svg>
      <div className="relative z-10 mb-8">
        <BrandLogo className="h-11 w-auto" />
      </div>
      <div className="relative z-10 w-full max-w-md rounded-2xl bg-white p-8 shadow-hero">{children}</div>
    </main>
  );
}
