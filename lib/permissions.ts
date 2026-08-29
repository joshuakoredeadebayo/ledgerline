/**
 * Ledgerline permission model.
 *
 * This is the application-level mirror of the RLS policies in
 * supabase/migrations — treat this file as defense-in-depth, not the
 * source of truth. The database enforces the real boundary; this file
 * is what drives UI (hiding/disabling controls) and early rejection of
 * actions before they hit the database.
 */

export type Role = "owner" | "admin" | "controller" | "accountant" | "auditor";

export type Permission =
  | "org.manage_billing"
  | "org.delete"
  | "org.manage_members"
  | "org.manage_integrations"
  | "entities.manage"
  | "reconciliation.view"
  | "reconciliation.match"
  | "reconciliation.finalize"
  | "journal_entries.draft"
  | "journal_entries.post"
  | "close.manage_checklist"
  | "close.lock_period"
  | "reports.view"
  | "audit_log.view"
  | "audit_log.export";

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: [
    "org.manage_billing",
    "org.delete",
    "org.manage_members",
    "org.manage_integrations",
    "entities.manage",
    "reconciliation.view",
    "reconciliation.match",
    "reconciliation.finalize",
    "journal_entries.draft",
    "journal_entries.post",
    "close.manage_checklist",
    "close.lock_period",
    "reports.view",
    "audit_log.view",
    "audit_log.export",
  ],
  admin: [
    "org.manage_members",
    "org.manage_integrations",
    "entities.manage",
    "reconciliation.view",
    "reports.view",
    "audit_log.view",
  ],
  controller: [
    "reconciliation.view",
    "reconciliation.match",
    "reconciliation.finalize",
    "journal_entries.draft",
    "journal_entries.post",
    "close.manage_checklist",
    "close.lock_period",
    "reports.view",
    "audit_log.view",
  ],
  accountant: [
    "reconciliation.view",
    "reconciliation.match",
    "journal_entries.draft",
    "reports.view",
  ],
  auditor: ["reconciliation.view", "reports.view", "audit_log.view", "audit_log.export"],
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/** Throws if the role lacks the permission — use at the top of Server Actions. */
export function assertPermission(role: Role, permission: Permission) {
  if (!can(role, permission)) {
    throw new Error(`Forbidden: role "${role}" lacks permission "${permission}".`);
  }
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  controller: "Controller",
  accountant: "Accountant",
  auditor: "Auditor",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: "Full business visibility, financial overview, major approvals, settings.",
  admin: "User management, configuration, operational administration.",
  controller: "Financial oversight, approvals, reconciliation, reporting, period close.",
  accountant: "Transactions, journals, invoices, bills, reconciliation, bookkeeping.",
  auditor: "Read-only access, audit trail, reports, review and compliance.",
};
