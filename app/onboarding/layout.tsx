import { Source_Serif_4 } from "next/font/google";

// A single, deliberate typographic departure for this one arrival moment —
// a restrained serif for the headline only, everything else in the app
// stays on the standard Geist/Inter sans system. Scoped to this route via
// a CSS variable rather than a global font swap.
const serif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["500", "600"],
  style: ["normal", "italic"],
  variable: "--font-onboarding-serif",
});

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${serif.variable} min-h-screen bg-ink-50`}>
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-16">
        {children}
      </div>
    </div>
  );
}
