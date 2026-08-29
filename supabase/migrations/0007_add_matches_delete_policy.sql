-- The matches/match_lines tables had insert and update policies but no
-- delete policy. RLS with no permissive DELETE policy silently blocks
-- all deletes (no error, just zero rows affected) — which meant
-- syncSuggestedMatches()'s "wipe stale pending suggestions before
-- regenerating" step was doing nothing, and every recompute added a
-- fresh duplicate set on top of the last one instead of replacing it.

create policy "accountant+ delete matches" on matches for delete
  using (current_role_in_org((select organization_id from entities where id = entity_id)) in ('owner','controller','accountant'));

create policy "accountant+ delete match_lines" on match_lines for delete
  using (
    current_role_in_org(
      (select organization_id from entities e join matches m on m.entity_id = e.id where m.id = match_id)
    ) in ('owner','controller','accountant')
  );
