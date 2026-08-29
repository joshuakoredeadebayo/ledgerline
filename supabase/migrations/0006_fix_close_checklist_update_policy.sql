-- The auto-verified checklist items ("All accounts reconciled", "No open
-- exceptions") get updated automatically as a side effect of everyday
-- reconciliation work — confirming a match, rejecting one, adding a
-- transaction. That work is normally done by the Accountant role, but
-- the original update policy on close_checklist_items only allowed the
-- item's assignee or a Controller/Owner. Since auto items have no
-- assignee, an Accountant's routine reconciliation action would have
-- silently failed to refresh the close checklist under RLS. Broadening
-- this to accountant+ (matching the pattern used everywhere else in this
-- schema) fixes that; the finer human-judgment rule for the one manual
-- item is still enforced in application code, not here.

drop policy "assignee or controller+ update checklist item" on close_checklist_items;

create policy "accountant+ or assignee can update checklist item" on close_checklist_items for update
  using (
    assignee_id = auth.uid()
    or current_role_in_org(
      (select organization_id from entities e join close_periods p on p.entity_id = e.id where p.id = close_period_id)
    ) in ('owner','controller','accountant')
  );
