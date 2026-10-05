import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Inter is the typeface used in the approved dashboard design. Exposed as a
// CSS variable so globals.css can put it first in the --font-sans stack.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: {
    default: "Ledgerline — Reconciliation & Close, done right",
    template: "%s · Ledgerline",
  },
  description:
    "Bank and ledger reconciliation, close checklists, and audit trails built for mid-market finance teams.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`h-full ${inter.variable}`}>
      <body className="h-full">{children}</body>
    </html>
  );
}
