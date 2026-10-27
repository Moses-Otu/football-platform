import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client: bypasses row-level security. Use only on the server,
 * for sync jobs and server actions that enforce game rules themselves.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
