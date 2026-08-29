import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Service-role Supabase client. BYPASSES ROW-LEVEL SECURITY.
 *
 * Only ever import this in server-only code that never runs in a request
 * scoped to a specific user's session — e.g. webhook handlers (Plaid,
 * QuickBooks callbacks) and scheduled sync jobs, where there is no logged-in
 * user to scope the request to.
 *
 * Never import this in a Server Action or Route Handler that acts on
 * behalf of a signed-in user — use lib/supabase/server.ts for that so RLS
 * stays the enforced source of truth.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
