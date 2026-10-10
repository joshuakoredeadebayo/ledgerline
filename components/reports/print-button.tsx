"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Opens the browser's print dialog, where "Save as PDF" gives a PDF copy of the report. */
export function PrintButton() {
  return (
    <Button type="button" variant="secondary" onClick={() => window.print()}>
      <Printer className="h-4 w-4" />
      Print or save as PDF
    </Button>
  );
}
