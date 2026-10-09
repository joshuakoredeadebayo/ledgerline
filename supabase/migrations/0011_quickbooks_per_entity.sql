-- 0011: QuickBooks connections per entity.
-- Until now a QuickBooks connection belonged to the whole organization. This lets a
-- connection belong to one entity, so two entities can each be linked to their own
-- QuickBooks company. A connection with no entity (every existing one) keeps working
-- as a shared, organization-wide connection. Safe to run more than once.

alter table quickbooks_items
  add column if not exists entity_id uuid references entities(id) on delete set null;

create index if not exists quickbooks_items_entity_idx on quickbooks_items (entity_id);
