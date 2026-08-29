import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  label?: string;
  hint?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, label, hint, id, ...props }, ref) => {
    const inputId = id ?? React.useId();
    const errorId = error ? `${inputId}-error` : undefined;
    const hintId = hint ? `${inputId}-hint` : undefined;

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-ink-700">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={!!error}
          aria-describedby={cn(errorId, hintId) || undefined}
          className={cn(
            "h-9 rounded border border-ink-200 bg-white px-3 text-sm text-ink-900 placeholder:text-ink-400",
            "focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500",
            "disabled:bg-ink-50 disabled:text-ink-400",
            error && "border-status-exception focus:border-status-exception focus:ring-status-exception",
            className
          )}
          {...props}
        />
        {hint && !error && (
          <p id={hintId} className="text-xs text-ink-500">
            {hint}
          </p>
        )}
        {error && (
          <p id={errorId} role="alert" className="text-xs text-status-exception">
            {error}
          </p>
        )}
      </div>
    );
  }
);
Input.displayName = "Input";
