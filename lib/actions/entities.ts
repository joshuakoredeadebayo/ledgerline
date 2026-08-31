export async function createAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };

  assertPermission(membership.role, "entities.manage");

  const parsed = accountSchema.safeParse({
    entityId: formData.get("entityId"),
    name: formData.get("name"),
    account_type: formData.get("account_type"),
  });
  if (!parsed.success) {
    return { fieldErrors: Object.fromEntries(parsed.error.issues.map((i) => [i.path[0], i.message])) };
  }

  const supabase = await createClient();

  // Race-safe code assignment: the (entity_id, code) unique constraint on
  // `accounts` is the real guarantee against duplicates. This loop just
  // makes a collision (two accounts of the same type created back-to-back)
  // recover gracefully instead of surfacing a raw database error — one
  // retry with a freshly recalculated code is enough, since the first
  // insert's failure means the second request's code is now free.
  const MAX_ATTEMPTS = 3;
  let lastError: string | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = await generateNextAccountCode(supabase, parsed.data.entityId, parsed.data.account_type);

    const { error } = await supabase.from("accounts").insert({
      entity_id: parsed.data.entityId,
      name: parsed.data.name,
      account_type: parsed.data.account_type,
      code,
      is_reconcilable: true,
    });

    if (!error) {
      revalidatePath(`/entities/${parsed.data.entityId}`);
      revalidatePath("/reconciliation");
      return { success: true };
    }

    // Postgres unique_violation is error code 23505. Only that specific
    // error is worth retrying — anything else (permissions, bad data,
    // connection issues) should surface immediately rather than loop.
    if (error.code !== "23505") {
      return { error: error.message };
    }

    lastError = error.message;
  }

  return { error: lastError ?? "Could not assign an account code after multiple attempts. Please try again." };
}