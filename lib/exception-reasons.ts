/** The reasons offered when closing an exception (kept out of the server-action file, which may only export functions). */
export const RESOLVE_REASONS = [
  "Timing difference",
  "Bank fee or charge, not yet booked",
  "Booked in another period",
  "Adjustment made elsewhere",
  "Other",
] as const;

export const DISMISS_REASONS = ["Duplicate", "Internal transfer", "Test or sample data", "Not relevant to this reconciliation", "Other"] as const;

export const EXCLUDE_REASONS = ["Duplicate", "Internal transfer", "Test or sample data", "Not part of this account", "Other"] as const;
