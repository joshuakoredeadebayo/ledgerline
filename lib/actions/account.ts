"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";

export type AccountActionState = { error?: string; success?: string } | null;

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    newPassword: z.string().min(8, "Use at least 8 characters for the new password."),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { message: "The new passwords don't match.", path: ["confirmPassword"] })
  .refine((v) => v.newPassword !== v.currentPassword, { message: "Choose a password you haven't used just now.", path: ["newPassword"] });

export async function changePassword(_prev: AccountActionState, formData: FormData): Promise<AccountActionState> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };

  const parsed = passwordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the details and try again." };

  const supabase = (await createClient()) as any;

  // Re-check the current password so a borrowed, unlocked session can't quietly lock the owner out.
  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: membership.email,
    password: parsed.data.currentPassword,
  });
  if (verifyError) return { error: "Your current password is incorrect." };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.newPassword });
  if (error) return { error: error.message };

  await supabase.from("audit_log").insert({
    organization_id: membership.organizationId,
    actor_id: membership.userId,
    action: "account.password_changed",
    target_table: "users",
    target_id: membership.userId,
    before: null,
    after: null,
  });

  return { success: "Password updated." };
}
