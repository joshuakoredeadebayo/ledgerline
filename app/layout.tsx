import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en" className="h-full">
      <body className="h-full">{children}</body>
    </html>
  );
}
