import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Supabase configuration
 */
export const SUPABASE_CONFIG = {
  url: Deno.env.get("SUPABASE_URL") || "",
  serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
  bucketName: Deno.env.get("SUPABASE_STORAGE_BUCKET") || "inspection-images",
} as const;

/**
 * Create Supabase client with service role key
 * Use this for server-side operations that bypass RLS
 */
export function createSupabaseClient() {
  return createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.serviceKey);
}

// Export singleton instance for convenience
export const supabase = createSupabaseClient();
