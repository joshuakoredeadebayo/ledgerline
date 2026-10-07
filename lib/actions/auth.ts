"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const loginSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

const signupSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters."),
  // Required for a normal signup; ignored when joining through an invitation.
  orgName: z.string().optional(),
  inviteToken: z.string().optional(),
});

export type ActionState = { error?: string; fieldErrors?: Record<string, string> } | null;

export async function login(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { fieldErrors: flatten(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { error: "Incorrect email or password." };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signup(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { fieldErrors: flatten(parsed.error) };
  }

  const supabase = await createClient();
  const inviteToken = parsed.data.inviteToken?.trim() || undefined;

  if (inviteToken) {
    // Joining an existing organization through an invitation link. The
    // database trigger attaches the new user to that organization; here we
    // only make sure the link is still valid and the email is the one invited.
    const { data: found } = await (supabase as any).rpc("lookup_invitation", { p_token: inviteToken });
    const invitation = (found ?? [])[0] as { invited_email: string } | undefined;
    if (!invitation) {
      return { error: "This invitation is invalid, already used, or has expired. Ask for a new link." };
    }
    if (invitation.invited_email.toLowerCase() !== parsed.data.email.trim().toLowerCase()) {
      return { fieldErrors: { email: "Use the email address this invitation was sent to." } };
    }

    const { error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: { data: { invite_token: inviteToken } },
    });
    if (error) {
      console.error("[signup:invite] Supabase error:", error.status, error.message);
      return {
        error:
          error.message === "User already registered"
            ? "An account with that email already exists. Ledgerline doesn't support one account in two organizations yet."
            : error.message,
      };
    }
    redirect("/dashboard");
  }

  if (!parsed.data.orgName?.trim()) {
    return { fieldErrors: { orgName: "Enter your company name." } };
  }

  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { org_name: parsed.data.orgName.trim() } },
  });

  if (error) {
    console.error("[signup] Supabase error:", error.status, error.message);
    return {
      error:
        error.message === "User already registered"
          ? "An account with that email already exists."
          : error.message, // TEMP: showing raw message while we debug — will tidy up after
    };
  }

  redirect("/onboarding");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

function flatten(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !out[key]) out[key] = issue.message;
  }
  return out;
}
