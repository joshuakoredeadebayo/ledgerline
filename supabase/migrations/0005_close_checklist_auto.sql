-- Distinguishes checklist items the system verifies automatically from
-- data (e.g. "all accounts reconciled") from items that genuinely need a
-- human to look and confirm (e.g. "final review complete"). Auto items
-- are never manually toggled — recomputeCloseChecklist() is the only
-- thing that ever changes their status.
alter table close_checklist_items add column is_auto boolean not null default false;
