-- The original schema gave `transactions` a select policy and an update
-- policy, but never an insert policy. With RLS enabled and no permissive
-- INSERT policy, every insert is denied by default — this has been true
-- since the very first migration, it just hadn't been exercised yet.

create policy "accountant+ insert transactions" on transactions for insert
  with check (current_role_in_org((select organization_id from entities where id = entity_id))
              in ('owner','controller','accountant'));

-- Same gap on `exceptions` — rejectMatch() inserts a row here, but no
-- INSERT policy ever existed for this table either.
create policy "accountant+ insert exceptions" on exceptions for insert
  with check (current_role_in_org((select organization_id from entities where id = entity_id))
              in ('owner','controller','accountant'));
