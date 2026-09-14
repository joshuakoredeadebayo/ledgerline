-- accounts: mirrors accounts' own existing INSERT policy role set
-- (owner/admin/controller — this table happens to use "admin" where
-- most others use "accountant", an existing inconsistency in the
-- schema, not something introduced here).
create policy "owner/admin/controller delete accounts" on accounts
  for delete using (
    current_role_in_org((select organization_id from entities where entities.id = accounts.entity_id))
    = any (array['owner','admin','controller'])
  );

-- journal_entry_lines: mirrors its own existing INSERT policy's role set.
create policy "accountant+ update je_lines" on journal_entry_lines
  for update using (
    current_role_in_org((
      select e.organization_id from journal_entries je
      join entities e on e.id = je.entity_id
      where je.id = journal_entry_lines.journal_entry_id
    )) = any (array['owner','controller','accountant'])
  );

-- reconciliations: mirrors its own existing INSERT/UPDATE policies.
create policy "accountant+ delete reconciliations" on reconciliations
  for delete using (
    current_role_in_org((select organization_id from entities where entities.id = reconciliations.entity_id))
    = any (array['owner','controller','accountant'])
  );

-- exceptions: mirrors its own existing INSERT/UPDATE policies.
create policy "accountant+ delete exceptions" on exceptions
  for delete using (
    current_role_in_org((select organization_id from entities where entities.id = exceptions.entity_id))
    = any (array['owner','controller','accountant'])
  );
