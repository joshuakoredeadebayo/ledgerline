/**
 * Shared looks for the action buttons in table rows, so every row reads the same way:
 * a bordered button for a decision (the main one outlined in blue), and quiet text actions with small
 * icons, separated by thin lines, for everything else.
 */
export const ACTION_BUTTON =
  "inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-ink-200 bg-white px-5 text-sm font-medium text-ink-800 transition-colors hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-50";

export const ACTION_BUTTON_PRIMARY =
  "inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-accent-500 bg-white px-5 text-sm font-semibold text-accent-600 transition-colors hover:bg-accent-50 disabled:cursor-not-allowed disabled:opacity-50";

export const ACTION_LINK =
  "inline-flex h-5 items-center gap-1.5 whitespace-nowrap px-3 text-sm font-medium text-ink-700 transition-colors first:pl-0 last:pr-0 hover:text-accent-700";

/** The row that holds the quiet actions. */
export const ACTION_LINK_ROW = "flex items-center justify-end divide-x divide-ink-200";
