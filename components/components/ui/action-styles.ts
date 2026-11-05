/**
 * Shared looks for the action buttons in table rows, so every row reads the same way:
 * a bordered button for a decision (Resolve, Dismiss, Reopen), and a quiet text action for everything else.
 */
export const ACTION_BUTTON =
  "inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded border border-ink-200 bg-white px-3 text-sm font-medium text-ink-800 transition-colors hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-50";

export const ACTION_LINK =
  "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded px-2.5 text-sm font-medium text-ink-600 transition-colors hover:bg-ink-50 hover:text-ink-900";
