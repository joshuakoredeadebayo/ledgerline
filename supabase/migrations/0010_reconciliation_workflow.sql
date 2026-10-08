-- 0010: exception handling — a recorded reason and note when someone resolves or dismisses an exception.
-- Safe to run more than once. Run it in the Supabase SQL editor.

alter table exceptions add column if not exists resolution_reason text;
alter table exceptions add column if not exists resolution_note text;

-- Accountants and above already update exceptions during everyday reconciliation (the
-- app does it when a match is confirmed). This makes the rule explicit and idempotent.
drop policy if exists "accountant+ update exceptions" on exceptions;
create policy "accountant+ update exceptions" on exceptions
  for update
  using (
    current_role_in_org((select organization_id from entities where entities.id = exceptions.entity_id))
      = any (array['owner','controller','accountant'])
  )
  with check (
    current_role_in_org((select organization_id from entities where entities.id = exceptions.entity_id))
      = any (array['owner','controller','accountant'])
  );
