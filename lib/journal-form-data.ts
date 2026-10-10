import { createClient } from "@/lib/supabase/server";
import type { FormAccount, FormEntity } from "@/components/journal/journal-entry-form";

/** The active entities and their active accounts, shaped for the journal entry form. */
export async function loadJournalFormData(): Promise<{ entities: FormEntity[]; accounts: FormAccount[] }> {
  const supabase = (await createClient()) as any;
  const { data: entityRows } = await supabase.from("entities").select("id, name, currency").is("archived_at", null).order("name");
  const entities: FormEntity[] = (entityRows ?? []) as FormEntity[];

  const { data: accountRows } = entities.length
    ? await supabase
        .from("accounts")
        .select("id, entity_id, name, code, account_type, is_reconcilable")
        .in("entity_id", entities.map((e) => e.id))
        .is("archived_at", null)
        .order("code")
    : { data: [] };

  const accounts: FormAccount[] = ((accountRows ?? []) as any[]).map((a) => ({
    id: a.id,
    entityId: a.entity_id,
    name: a.name,
    code: a.code,
    accountType: a.account_type,
    reconcilable: !!a.is_reconcilable,
  }));
  return { entities, accounts };
}
