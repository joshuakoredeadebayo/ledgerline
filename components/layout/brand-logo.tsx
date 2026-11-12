import Image from "next/image";

/** The Ledgerline logo. `full` is the icon with the wordmark (for dark backgrounds); `icon` is the icon alone. */
export function BrandLogo({ variant = "full", className }: { variant?: "full" | "icon"; className?: string }) {
  return variant === "icon" ? (
    <Image src="/brand/logo-icon.png" alt="Ledgerline" width={40} height={40} priority className={className ?? "h-10 w-10"} />
  ) : (
    <Image src="/brand/logo-full.png" alt="Ledgerline" width={720} height={157} priority className={className ?? "h-9 w-auto"} />
  );
}
