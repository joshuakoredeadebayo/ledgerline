"use client";

import { useTransition } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { closePeriod } from "@/lib/actions/close";

export function CloseButton({ closePeriodId, disabled }: { closePeriodId: string; disabled: boolean }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      disabled={disabled}
      loading={isPending}
      onClick={() => startTransition(() => closePeriod(closePeriodId))}
      title={disabled ? "Every checklist item needs to be complete first" : undefined}
    >
      <Lock className="h-3.5 w-3.5" />
      Close period
    </Button>
  );
}
